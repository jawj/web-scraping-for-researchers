
/* Scrape vote counts for UK government petitions into a CSV
   Copyright (C) 2017 George MacKerron
   Made available under the MIT Licence: https://opensource.org/licenses/MIT
 
 * Use any up-to-date browser: Chrome, Firefox, Safari, Edge, IE (these are listed from best to worst)
 * For Safari only, first go to Preferences > Advanced, and check 'Show Develop menu in menu bar'
 
 * Visit https://petition.parliament.uk/petitions?state=with_response
 * Press Cmd + Alt + I (Mac) or F12 or Ctrl + Shift + I (PC) to open developer tools
 * Click 'Console', paste this script in at the > or >>, and press Return
 * To abort at any time, type `abort();` and press Return
 */

function start() {
  // This function creates and styles an <iframe> to load pages in, and a <textarea> to write our data to.
  // It then kicks things off by loading the current page URL into the iframe.

  textarea = document.body.appendChild(document.createElement('textarea'));  // textarea is global
  iframe = document.body.appendChild(document.createElement('iframe'));      // iframe is global

  var commonStyles = { position: 'absolute', left: '2%', width: '96%', border: '2px solid #0af' };
  Object.assign(textarea.style, commonStyles, { bottom: '2%', height: '26%' });
  Object.assign(iframe.style, commonStyles, { top: '2%', height: '66%' });

  iframe.addEventListener('load', process, false);
  iframe.contentWindow.location.href = window.location.href;
}

function write(/* any number of arguments */) {
  // This function writes its arguments as columns of a CSV file to the <textarea> we made.
  // Plus it keeps the output scrolled to the end if it's at the end already.

  var columns = Array.from(arguments).map(function (value) {
    var t = typeof value;
    return t == 'null' || t == 'undefined' ? '' :  // null or undefined -> empty/missing value
      t == 'number' ? String(value) :  // number -> unquoted
      t == 'boolean' ? (value ? '1' : '0') :  // boolean -> 0/1 dummy
      value instanceof Date ? value.toISOString().replace('T', ' ').replace('Z', '') :  // Date -> UTC date understood by Excel
      '"' + String(value).replace(/"/g, '""') + '"';  // anything else -> quote, escaping any contained quotes
  });
  var fullyScrolled = textarea.scrollTop >= textarea.scrollHeight - textarea.clientHeight - 1 ||  // the -1 makes this work in Edge
    textarea.clientHeight >= textarea.scrollHeight;  
  textarea.value += columns.join(',') + '\n';
  if (fullyScrolled) textarea.scrollTop = textarea.scrollHeight - textarea.clientHeight;
}

function abort() {
  // We can call this function to abort the task early if necessary

  clearTimeout(clickTimeout);
  iframe.removeEventListener('load', process, false);
}

function process() {
  // This function has two jobs: (1) extracting data from the current iframe page; 
  // and (2) navigating to the next page. Both parts will need customising for other scraping tasks.

  console.log('Processing', iframe.contentWindow.location.href);
  var doc = iframe.contentDocument;
  var timestamp = new Date();

  Array.from(doc.querySelectorAll('.petition-item')).forEach(function (item) {  // use Array.from because NodeList has no forEach in Edge
    var count = parseInt(item.querySelector('.count').getAttribute('data-count'));
    var title = item.querySelector('h3 a');
    var name = title.text;
    write(count, name, timestamp);
  });

  var nextLink = doc.querySelector('a.next');
  if (nextLink) clickTimeout = setTimeout(function () { nextLink.click(); }, 500);  // clickTimeout is global
  else console.log('Finished.');
}

// These two lines provide basic 'polyfills' for IE, which lacks some modern JavaScript niceties
if (!Array.from) Array.from = function (arraylike) { return [].slice.call(arraylike); };
if (!Object.assign) Object.assign = function (o1) {
  [].slice.call(arguments, 1).forEach(function (o2) { for (var key in o2) o1[key] = o2[key]; });
};

start();
