
/* Scrape English and Scottish football leagues kick-off times and goal times 
   from uk.soccerway.com for a predefined list of matches provided in a CSV file
   
   Copyright (C) 2017 - 2018 George MacKerron
   Made available under the MIT Licence: https://opensource.org/licenses/MIT

   This is a much more complex task, and we use async/await to enable a synchronous-style main loop
   (it's ES6 but we stick with var, not let/const, because let/const can get in the way when working interactively)
 
 * Use a modern browser — this has been tested in Chrome
 * Now that SoccerWay is https-only, Chrome needs to be run with the  --allow-running-insecure-content flag

 * Prepare to serve local files (JS libraries, data) from this folder. In Terminal:
   > echo '127.0.0.1 right.here' | sudo tee -a /etc/hosts  # because 'localhost' doesn't work with CORS
   > sudo npm install -g http-server; http-server --cors

 * Visit https://uk.soccerway.com/
 * Press Cmd + Alt + I (Mac) or Ctrl + Shift + I (PC) to open developer tools
 * Click 'Console', paste this script in at the > or >>, and press Return
 * Close the developer tools once it's working, or you'll quickly rack up enormous memory usage
 * To abort, reload the page
 */


var make = (doc, ...tags) => tags.map(tag => doc.body.appendChild(doc.createElement(tag)));
var qsa = (el, q) => [].slice.call(el.querySelectorAll(q));


// == Make and style overlay elements ==

var [indexFrame, matchFrame, textarea] = make(document, 'iframe', 'iframe', 'textarea');
var commonStyles = { position: 'absolute', left: '2%', width: '96%', height: '30%', border: '2px solid #0af', zIndex: 10000 };
Object.assign(indexFrame.style, commonStyles, { top: '2%' });
Object.assign(matchFrame.style, commonStyles, { top: '34%' });
Object.assign(textarea.style, commonStyles, { top: '66%' });

// restore CSV value from localStorage to textarea in case of reload etc.
textarea.value = localStorage.getItem('csv') || '';


// == Utility functions and Promise-ification ==

// load a JS script (by appending a script tag to <head>), returning Promise
var loadScript = (src) => new Promise(resolve => {
  var scriptTag = document.createElement('script');
  scriptTag.onload = resolve;
  scriptTag.src = src;
  document.getElementsByTagName('head')[0].appendChild(scriptTag);
});

// fetch and parse a subset of CSV (no quotes!) including a header into an array of objects
// e.g. "header1,header2\n1,a\n2,b" becomes [{header1: '1', header2: 'a'}, {header1: '2', header2: 'b'}]
var loadSimpleCSV = async (url) => {
  var res = await fetch(url);
  var txt = await res.text();
  var rows = txt.split('\n');
  var headers = rows.shift().split(',');
  var len = headers.length;
  var data = rows.map(row => {
    var cols = {};
    var fields = row.split(',');
    for (var i = 0; i < len; i++) cols[headers[i]] = fields[i];
    return cols;
  });
  return data;
};

// write values as columns of a CSV file to textarea, save to localStorage, and keep scrolled to end
var writeCSV = (...values) => {
  var columns = values.map(value => {
    var t = typeof value;
    return value == null ? '' :  // catches undefined too
      t == 'number' ? String(value) :
      t == 'boolean' ? (value ? '1' : '0') :
      value instanceof Date ? value.toISOString().replace('T', ' ').replace('Z', '') :
      '"' + String(value).replace(/"/g, '""') + '"';
  });
  var fullyScrolled = textarea.scrollTop >= textarea.scrollHeight - textarea.clientHeight - 1 ||
    textarea.clientHeight >= textarea.scrollHeight;
  textarea.value += columns.join(',') + '\n';
  if (fullyScrolled) textarea.scrollTop = textarea.scrollHeight - textarea.clientHeight;
  localStorage.setItem('csv', textarea.value);
}

// add an event listener that removes itself as soon as it's called
var addOneTimeEventListener = (element, event, listener) => {
  var wrappedListener = (...args) => {
    element.removeEventListener(event, wrappedListener);
    listener(...args);
  };
  element.addEventListener(event, wrappedListener);
}

// Promise-ified navigation
var openURLInFrame = (URL, frame) => new Promise(resolve => {
  console.log(`Loading ${URL} ...`);
  addOneTimeEventListener(frame, 'load', resolve);
  frame.contentWindow.location.href = URL;
});

// Promise-ified setTimeout
var sleep = (seconds) => new Promise(resolve => {
  console.log(`Sleeping for ${seconds.toFixed(1)} seconds`);
  setTimeout(resolve, seconds * 1000)
});
var sleepBetween = (min, max) => sleep(min + Math.random() * (max - min));


// == Job-specific helpers ==

// map from source match data to Soccerway URL terminology
var leagueMap = {
  E0: 'england/premier-league',
  E1: 'england/championship',
  E2: 'england/league-one',
  E3: 'england/league-two',
  EC: 'england/conference',  // varying conference suffixes: use .startsWith()
  SC0: 'scotland/premier-league',
  SC1: 'scotland/first-division',
  SC2: 'scotland/second-division',
  SC3: 'scotland/third-division',
};

// click the 'UK' button to filter matches on a match date index page, and listen for the resulting mutation
var clickUK = () => new Promise(resolve => {
  console.log('Clicking [UK] ...');
  var observer = new MutationObserver(mutations => {
    // when the 'UK' button is clicked, a grey overlay is placed on top of the match data while new data is fetched;
    // when the new data has fully loaded, the overlay is removed, and that removal is what we listen for
    var removedOverlay = mutations.some(mutation => mutation.removedNodes.length > 0);
    if (removedOverlay) {
      observer.disconnect();
      resolve();
    }
  });
  var subtree = indexFrame.contentDocument.querySelector('.content-column .content');
  observer.observe(subtree, { childList: true });
  var ukButton = qsa(indexFrame.contentDocument, '.content-column .content .subnav li a')[1];
  ukButton.click();
});

// extract match data from a match date index page
var getMatches = () => qsa(indexFrame.contentDocument, '.matches td.info-button').map(td => {
  var tr = td.parentElement;
  var home = tr.querySelector('.team-a a').title;
  var away = tr.querySelector('.team-b a').title;
  var scoreLink = tr.querySelector('.score a');
  var score = scoreLink ? tr.querySelector('.score a').textContent : '999 - 999';
  var URL = tr.querySelector('.info-button a').href;
  var div = URL.match(/\/matches\/\d{4}\/\d{2}\/\d{2}\/(.+?\/.+?)\//)[1];  // e.g. 'england/championship'
  return { home, score, away, URL, div };
});


// == Main loop ==

// start the scraping process which, thanks to async/await, can be implemented as a simple loop
(async () => {  // only in Chrome can we await at top level in console, so use function wrapper for compatibility

  await loadScript('http://right.here:8080/trigrams.js');
  var csv = await loadSimpleCSV('http://right.here:8080/matches-to-look-up.csv');

  // count number of matches already retrieved via number of output lines, to decide where to start in source list,
  // then iterate over rows, which each represent a source match
  var newlines = textarea.value.match(/\n/g);
  for (var csvIndex = newlines ? newlines.length : 0, csvLen = csv.length; csvIndex < csvLen; csvIndex++) {
    
    var sourceMatch = csv[csvIndex];
    console.log('===');
    console.log('Looking for match: ', sourceMatch);

    // create an index page URL for the date of this source match, and load in iframe if not loaded already
    var dateURL = `https://uk.soccerway.com/matches/${sourceMatch.matchdate.replace(/-/g, '/')}/`;
    if (indexFrame.contentWindow.location.href != dateURL) {
      await openURLInFrame(dateURL, indexFrame);
      await sleepBetween(1, 2);  // don't pummel the server
      await clickUK();
    }

    // get all games on the page, then filter by same division and score
    var pageMatches = getMatches();
    var matchingPageMatches = pageMatches.filter(pageMatch =>
      pageMatch.score == `${sourceMatch.homegoals} - ${sourceMatch.awaygoals}` &&
        pageMatch.div.startsWith(leagueMap[sourceMatch.div])
    );
    console.log('Matches on score and league:', matchingPageMatches);

    // now pick best trigram match on team names from the filtered list
    var bestMatch = null, bestMatchQuality = 0;
    var sourceTrigrams = new Trigrams(`${sourceMatch.hometeam}  ${sourceMatch.awayteam}`);
    matchingPageMatches.forEach(match => {
      var trigrams = new Trigrams(`${match.home}  ${match.away}`);
      var matchQuality = trigrams.matchQualityWith(sourceTrigrams);
      if (matchQuality > bestMatchQuality) {
        bestMatchQuality = matchQuality;
        bestMatch = match;
      }
    });

    console.log('Best match, using trigrams:', bestMatchQuality, bestMatch);

    // retrieve data for the matched football match
    var kickOff = null, goals = [];
    if (bestMatch) {

      // load the match page in its own frame
      await sleepBetween(1, 2);  // don't pummel the server
      await openURLInFrame(bestMatch.URL, matchFrame);

      // get kick-off time (allowing for Scottish and English league formatting differences)
      var kickOffEl = qsa(matchFrame.contentDocument, '.details span').find(span =>
        span.previousElementSibling.textContent == 'KO') ||
        qsa(matchFrame.contentDocument, '.details dd').find(dd =>
          dd.previousElementSibling.textContent == 'Kick-off');
      kickOff = kickOffEl.textContent.trim();
        
      // get goal times -- different formats for English and Scottish leagues again
      // (a) Scotland-style
      goals = qsa(matchFrame.contentDocument, 'table.matches.events tr').map(tr => {
        var score = tr.querySelectorAll('td div')[1].textContent;
        var homeMin = tr.querySelector('.player-a .minute');
        var awayMin = tr.querySelector('.player-b .minute');
        var team = homeMin ? 'home' : 'away';
        var minute = parseInt(homeMin ? homeMin.textContent : awayMin.textContent);
        return { minute, team, score };
      });

      // (b) England-style
      if (goals.length == 0) goals = qsa(matchFrame.contentDocument, 'ul.scorer-info li').map(li => {
        var score = li.querySelector('.score').textContent;
        var homeMin = li.querySelector('.scorer:first-child .minute');
        var awayMin = li.querySelector('.scorer:not(:first-child) .minute');
        var team = homeMin ? 'home' : 'away';
        var minute = parseInt(homeMin ? homeMin.textContent : awayMin.textContent);
        return { minute, team, score };
      })
    }

    // save data for this match to CSV
    writeCSV(
      sourceMatch.div,
      sourceMatch.matchdate,
      sourceMatch.hometeam,
      sourceMatch.awayteam,
      parseInt(sourceMatch.homegoals),
      parseInt(sourceMatch.awaygoals),
      kickOff,
      goals.map(goal => `${goal.minute} : ${goal.team} : ${goal.score}`).join(' / '),
      parseFloat(bestMatchQuality.toFixed(3)),
      bestMatch ? bestMatch.home : null,
      bestMatch ? bestMatch.away : null
    );

    await sleepBetween(2, 5);  // don't pummel server
  }
})();
