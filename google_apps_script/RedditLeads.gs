/**
 * Reddit AI lead generator for Google Sheets.
 *
 * Fetches Reddit's public JSON API from Google's servers - no Reddit account,
 * no API key, no OAuth. Same rules as the Python version: AI-related, hiring
 * intent, remote only (onsite/hybrid excluded), posted within MAX_AGE_DAYS,
 * deduplicated, ranked, top N written to a sheet.
 *
 * Setup: sheets.new -> Extensions -> Apps Script -> paste this file -> Save ->
 * Run `generateLeads`, approve the one-time permission prompt, then reload the
 * sheet to get the "Reddit Leads" menu.
 */

var CONFIG = {
  MAX_AGE_DAYS: 14,
  LEAD_COUNT: 20,
  SHEET_NAME: 'AI Remote Leads',
  REQUEST_DELAY_MS: 1200,
  TRY_OLD_REDDIT: true,
  USER_AGENT: 'web:reddit-ai-leads:1.0 (public JSON reader, no account)'
};

var GIG_SUBREDDITS = ['forhire', 'jobbit', 'hiring', 'freelance_forhire',
                      'RemoteJobs', 'remotejs', 'WorkOnline', 'b2bforhire'];
var AI_SUBREDDITS = ['AI_Agents', 'n8n', 'LLMDevs', 'MachineLearningJobs',
                     'automation', 'LocalLLaMA', 'PromptEngineering'];
var GIG_QUERIES = ['AI OR LLM OR GPT',
                   'machine learning OR deep learning OR NLP',
                   'chatbot OR automation OR n8n OR prompt engineer'];
var AI_QUERIES = ['hiring OR recruiting OR vacancy',
                  'freelancer OR contractor OR paid OR budget'];
var GLOBAL_QUERIES = ['hiring AI engineer remote',
                      'looking for AI developer remote paid',
                      'hiring LLM developer remote',
                      'AI automation developer needed remote',
                      'hiring machine learning engineer remote',
                      'need AI agent developer remote paid'];

var AI_STRONG = ['artificial intelligence','machine learning','deep learning','large language model','llm','llms','generative ai','genai','gpt','chatgpt','openai','anthropic','claude','gemini','llama','mistral','hugging face','huggingface','langchain','langgraph','llamaindex','crewai','autogen','rag','vector database','pinecone','embeddings','chatbot','chat bot','voice agent','conversational ai','nlp','natural language processing','computer vision','prompt engineer','prompt engineering','fine-tune','fine tune','fine-tuning','stable diffusion','comfyui','midjourney','pytorch','tensorflow','mlops','ml engineer','ai engineer','ai developer','ai agent','ai agents','agentic','whisper','text to speech','speech to text','ocr','data annotation','ai automation','ai workflow','n8n'];
var AI_WEAK = ['ai','automation','automate','zapier','scraper','scraping','python','model','algorithm'];
var HIRING = ['hiring','looking for','looking to hire','seeking','need someone','need a developer','need help','want to hire','job opening','open position','vacancy','recruiting','contract','contractor','freelance','freelancer','consultant','budget','paid','will pay','compensation','salary','rate','apply','dm me','pm me'];
var REMOTE = ['remote','fully remote','work from home','wfh','telecommute','anywhere','worldwide','global','any timezone','distributed team','async','online','virtual'];
var ONSITE = ['onsite','on-site','on site','in-person','in person','in office','in-office','on premise','on-premise','hybrid','must be located','must be based','must reside','must live in','must be local','local only','locals only','local candidates','relocate','relocation','commute','commutable','days in the office','days in office','come to the office','our office','office-based','office based'];
var NEGATIONS = ['no','not','non','never','zero','without','avoid'];
var REMOTE_SUBS = ['remotejobs','remotejs','workonline','jobbit'];
var SELF_PROMO_PREFIX = ['[for hire]','[forhire]','(for hire)','for hire','[available]','available for hire','hire me','[task]','[advert]'];
var JOB_TERMS = ['full-time','full time','part-time','part time','salary','salaried','benefits','position','role','employee','annual','per year','/yr'];
var STOPWORDS = ['a','an','the','for','to','of','and','or','in','on','at','with','we','our','you','your','is','are','be','need','needed','looking','hiring','hire','job','role','remote','usd','hour','hr','week','month','paid','pay','help','please','new','up'];

var HEADERS = ['date_posted_utc','days_ago','subreddit','title','lead_type','work_location',
               'remote_evidence','pay_or_budget','author','post_url','contact','comments',
               'lead_score','why_it_matches','snippet'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Reddit Leads')
    .addItem('Generate AI remote leads', 'generateLeads')
    .addToUi();
}

/** Entry point. */
function generateLeads() {
  var posts = fetchAllPosts();
  var result = buildLeads(posts);
  writeSheet(result.rows);
  var message = posts.length + ' posts scanned, ' + result.stats.unique +
    ' unique leads found, ' + result.rows.length + ' written.';
  if (posts.length === 0) {
    message += ' No posts came back at all -- HTTP codes: ' +
      JSON.stringify(FETCH_LOG.byCode) + ' | first body: ' +
      (FETCH_LOG.sample || '(empty)');
  }
  Logger.log(message);
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Reddit Leads', 10);
  } catch (e) {
    // Running from the editor with no bound spreadsheet open.
  }
  return message;
}

// --- Fetching ---------------------------------------------------------------

function buildUrls() {
  var urls = [];
  var q = encodeURIComponent;
  var i, j;
  for (i = 0; i < GIG_SUBREDDITS.length; i++) {
    for (j = 0; j < GIG_QUERIES.length; j++) {
      urls.push('https://www.reddit.com/r/' + GIG_SUBREDDITS[i] + '/search.json?q=' +
                q(GIG_QUERIES[j]) + '&restrict_sr=1&sort=new&t=month&limit=100&raw_json=1');
    }
  }
  for (i = 0; i < AI_SUBREDDITS.length; i++) {
    urls.push('https://www.reddit.com/r/' + AI_SUBREDDITS[i] + '/new.json?limit=100&raw_json=1');
    for (j = 0; j < AI_QUERIES.length; j++) {
      urls.push('https://www.reddit.com/r/' + AI_SUBREDDITS[i] + '/search.json?q=' +
                q(AI_QUERIES[j]) + '&restrict_sr=1&sort=new&t=month&limit=100&raw_json=1');
    }
  }
  for (i = 0; i < GLOBAL_QUERIES.length; i++) {
    urls.push('https://www.reddit.com/search.json?q=' + q(GLOBAL_QUERIES[i]) +
              '&sort=new&t=month&limit=100&raw_json=1');
  }
  return urls;
}

/** Per-run record of what Reddit actually answered, so a zero-result run
 *  reports the reason instead of silently writing an empty sheet. */
var FETCH_LOG = { ok: 0, failed: 0, byCode: {}, sample: '' };

function noteCode(code) {
  FETCH_LOG.byCode[code] = (FETCH_LOG.byCode[code] || 0) + 1;
}

function noteSample(body) {
  if (!FETCH_LOG.sample) {
    FETCH_LOG.sample = String(body || '').replace(/\s+/g, ' ').slice(0, 300);
  }
}

function httpGet(url) {
  return UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': CONFIG.USER_AGENT,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
}

/**
 * Fetch one Reddit JSON URL.
 *
 * Reddit rate-limits and sometimes outright blocks datacenter IP ranges,
 * which is what Apps Script requests come from. When www.reddit.com refuses,
 * old.reddit.com is tried as well - it is served by a different stack and is
 * often more permissive.
 */
function fetchJson(url) {
  var variants = [url];
  if (CONFIG.TRY_OLD_REDDIT && url.indexOf('://www.reddit.com') !== -1) {
    variants.push(url.replace('://www.reddit.com', '://old.reddit.com'));
  }

  for (var v = 0; v < variants.length; v++) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var response;
      try {
        response = httpGet(variants[v]);
      } catch (e) {
        noteCode('exception');
        noteSample(e.message);
        break;
      }

      var code = response.getResponseCode();
      noteCode(code);

      if (code === 200) {
        var body = response.getContentText();
        try {
          var parsed = JSON.parse(body);
          FETCH_LOG.ok++;
          return parsed;
        } catch (e) {
          // HTTP 200 carrying HTML means an interstitial or block page.
          noteSample(body);
          break;
        }
      }

      if (code === 429 || code >= 500) {
        Utilities.sleep(CONFIG.REQUEST_DELAY_MS * Math.pow(2, attempt + 1));
        continue;
      }

      noteSample(response.getContentText());
      break;
    }
  }

  FETCH_LOG.failed++;
  return null;
}

/**
 * Diagnostic: run this on its own to see exactly what Reddit answers.
 * Check View > Logs afterwards.
 */
function testFetch() {
  var urls = [
    'https://www.reddit.com/r/forhire/new.json?limit=5&raw_json=1',
    'https://old.reddit.com/r/forhire/new.json?limit=5&raw_json=1',
    'https://www.reddit.com/r/forhire/new.rss?limit=5'
  ];
  var lines = [];
  for (var i = 0; i < urls.length; i++) {
    var line;
    try {
      var response = httpGet(urls[i]);
      var body = response.getContentText();
      var children = -1;
      try {
        children = ((JSON.parse(body).data || {}).children || []).length;
      } catch (e) {
        children = -1;
      }
      line = urls[i] + '\n    HTTP ' + response.getResponseCode() +
             ' | bytes ' + body.length + ' | posts parsed ' + children +
             '\n    body: ' + body.replace(/\s+/g, ' ').slice(0, 250);
    } catch (e) {
      line = urls[i] + '\n    EXCEPTION: ' + e.message;
    }
    lines.push(line);
    Utilities.sleep(1500);
  }
  var report = lines.join('\n\n');
  Logger.log(report);
  return report;
}

function fetchAllPosts() {
  var urls = buildUrls();
  var posts = [];
  var seen = {};
  var consecutiveFailures = 0;

  FETCH_LOG = { ok: 0, failed: 0, byCode: {}, sample: '' };

  for (var i = 0; i < urls.length; i++) {
    var payload = fetchJson(urls[i]);

    if (!payload) {
      consecutiveFailures++;
      // Six failures in a row is a block, not bad luck. Stop rather than
      // spend the whole Apps Script quota discovering that 50 more times.
      if (consecutiveFailures >= 6) {
        throw new Error(
          'Reddit refused the first ' + consecutiveFailures + ' requests, so no ' +
          'leads could be collected. Response codes: ' + JSON.stringify(FETCH_LOG.byCode) +
          ' | first response body: ' + (FETCH_LOG.sample || '(empty)') +
          ' -- Reddit blocks or throttles requests from datacenter IP ranges, which is ' +
          'where Apps Script runs. Run the Python version from your own machine instead.');
      }
      Utilities.sleep(CONFIG.REQUEST_DELAY_MS);
      continue;
    }

    consecutiveFailures = 0;
    var children = (payload.data && payload.data.children) || [];
    for (var c = 0; c < children.length; c++) {
      var post = children[c].data;
      if (post && post.id && !seen[post.id]) {
        seen[post.id] = true;
        posts.push(post);
      }
    }
    Utilities.sleep(CONFIG.REQUEST_DELAY_MS);
  }
  return posts;
}

// --- Text matching ----------------------------------------------------------

function collapse(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isWordChar(ch) {
  return /[a-z0-9]/.test(ch);
}

function findTerm(text, term) {
  var from = 0;
  while (from <= text.length) {
    var i = text.indexOf(term, from);
    if (i === -1) { return -1; }
    var before = i > 0 ? text.charAt(i - 1) : ' ';
    var after = i + term.length < text.length ? text.charAt(i + term.length) : ' ';
    var leftOk = !isWordChar(term.charAt(0)) || !isWordChar(before);
    var rightOk = !isWordChar(term.charAt(term.length - 1)) || !isWordChar(after);
    if (leftOk && rightOk) { return i; }
    from = i + 1;
  }
  return -1;
}

function hits(text, terms) {
  var found = [];
  for (var i = 0; i < terms.length; i++) {
    if (findTerm(text, terms[i]) !== -1) { found.push(terms[i]); }
  }
  found.sort(function (a, b) { return b.length - a.length; });
  return found;
}

/** Onsite terms that are not cancelled by a preceding negation. */
function onsiteHits(text) {
  var found = [];
  for (var i = 0; i < ONSITE.length; i++) {
    var at = findTerm(text, ONSITE[i]);
    if (at === -1) { continue; }
    var before = text.slice(Math.max(0, at - 30), at);
    var words = before.replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(function (w) { return w; });
    var last = words.length ? words[words.length - 1] : '';
    if (NEGATIONS.indexOf(last) === -1) { found.push(ONSITE[i]); }
  }
  return found;
}

function extractPay(text) {
  var match = String(text || '').match(
    /(\$\s?\d[\d,.]*\s*(?:k|,000)?(?:\s*(?:-|–|to)\s*\$?\s?\d[\d,.]*\s*k?)?(?:\s*(?:\/|per\s+)(?:hr|hour|h|day|week|month|mo|year|yr|project))?|\d[\d,.]*\s*(?:usd|eur|gbp|cad|aud)\b|\b\d{2,3}\s*(?:\/|per\s+)(?:hr|hour)\b)/i);
  return match ? collapse(match[0]).replace(/[.,]+$/, '') : '';
}

function contactHint(post, body) {
  var email = String(body || '').match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) { return email[0]; }
  var handle = String(body || '').match(/(telegram|discord|whatsapp|calendly|t\.me\/\S+)/i);
  if (handle) { return handle[0]; }
  return 'Comment on post / DM u/' + post.author;
}

// --- Lead building ----------------------------------------------------------

function titleSignature(title) {
  var words = String(title || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  var kept = [];
  for (var i = 0; i < words.length; i++) {
    if (words[i].length > 2 && STOPWORDS.indexOf(words[i]) === -1 && kept.indexOf(words[i]) === -1) {
      kept.push(words[i]);
    }
  }
  return kept.sort().join(' ');
}

function buildLeads(posts) {
  var nowSec = Date.now() / 1000;
  var leads = [];

  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];
    var ageDays = (nowSec - (post.created_utc || 0)) / 86400;
    if (ageDays < 0 || ageDays > CONFIG.MAX_AGE_DAYS) { continue; }
    if (post.removed_by_category || post.selftext === '[removed]' ||
        post.selftext === '[deleted]') { continue; }

    var title = collapse(post.title);
    var titleLower = title.toLowerCase();
    var isSelfPromo = false;
    for (var s = 0; s < SELF_PROMO_PREFIX.length; s++) {
      if (titleLower.indexOf(SELF_PROMO_PREFIX[s]) === 0) { isSelfPromo = true; break; }
    }
    if (isSelfPromo) { continue; }

    var body = collapse(post.selftext);
    var text = titleLower + ' . ' + body.toLowerCase();

    var strong = hits(text, AI_STRONG);
    var weak = hits(text, AI_WEAK);
    if (strong.length === 0 && weak.length < 2) { continue; }

    var hiring = hits(text, HIRING);
    if (hiring.length === 0) { continue; }

    if (onsiteHits(text).length > 0) { continue; }

    var remote = hits(text, REMOTE);
    var sub = String(post.subreddit || '').toLowerCase();
    var remoteByRule = REMOTE_SUBS.indexOf(sub) !== -1;
    if (remote.length === 0 && !remoteByRule) { continue; }

    // --- score ---
    var reasons = [];
    var score = Math.min(strong.length * 3 + (strong.length ? Math.min(weak.length, 4) : 2), 12);
    reasons.push(strong.length ? 'AI: ' + strong.slice(0, 4).join(', ')
                               : 'AI-adjacent: ' + weak.slice(0, 3).join(', '));

    if (hits(titleLower, ['hiring', 'looking for', 'seeking']).length) {
      score += 4; reasons.push('hiring intent in title');
    } else {
      score += 2; reasons.push('hiring intent in body');
    }

    var pay = extractPay(title + ' ' + body);
    if (pay) { score += 4; reasons.push('budget stated (' + pay + ')'); }

    score += Math.max(0, (CONFIG.MAX_AGE_DAYS - ageDays) / CONFIG.MAX_AGE_DAYS) * 5;
    reasons.push(ageDays.toFixed(1) + ' days old');

    if (hits(titleLower, REMOTE).length) { score += 2; reasons.push('remote stated in title'); }
    if (body.length > 400) { score += 2; reasons.push('detailed post'); }
    else if (body.length < 80) { score -= 2; reasons.push('very short post'); }
    score += Math.min((post.num_comments || 0) * 0.1, 2);

    leads.push({
      score: Math.round(score * 100) / 100,
      id: post.id,
      author: String(post.author || '').toLowerCase(),
      signature: titleSignature(title),
      row: [
        Utilities.formatDate(new Date(post.created_utc * 1000), 'UTC', 'yyyy-MM-dd HH:mm'),
        Math.round(ageDays * 10) / 10,
        'r/' + post.subreddit,
        title,
        hits(text, JOB_TERMS).length ? 'job' : 'project/gig',
        'Remote',
        remote.length ? remote.slice(0, 3).join(', ')
                      : 'r/' + post.subreddit + ' is remote-only by subreddit rule',
        pay || 'not stated',
        'u/' + post.author,
        'https://www.reddit.com' + post.permalink,
        contactHint(post, body),
        post.num_comments || 0,
        Math.round(score * 100) / 100,
        reasons.join('; '),
        body.slice(0, 280)
      ]
    });
  }

  leads.sort(function (a, b) { return b.score - a.score; });

  // Deduplicate: same post id, same author re-posting, or an identical
  // distinctive title from any author.
  var seen = {};
  var unique = [];
  var duplicates = 0;
  for (var k = 0; k < leads.length; k++) {
    var lead = leads[k];
    var keys = ['id:' + lead.id];
    if (lead.signature) {
      keys.push('at:' + lead.author + '|' + lead.signature);
      if (lead.signature.split(' ').length >= 4) { keys.push('t:' + lead.signature); }
    }
    var clash = false;
    for (var x = 0; x < keys.length; x++) { if (seen[keys[x]]) { clash = true; } }
    if (clash) { duplicates++; continue; }
    for (var y = 0; y < keys.length; y++) { seen[keys[y]] = true; }
    unique.push(lead);
  }

  var rows = [];
  for (var r = 0; r < Math.min(CONFIG.LEAD_COUNT, unique.length); r++) {
    rows.push(unique[r].row);
  }
  return { rows: rows, stats: { unique: unique.length, duplicates: duplicates } };
}

// --- Output -----------------------------------------------------------------

function writeSheet(rows) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Open this script from a Google Sheet (Extensions > Apps Script).');
  }
  var sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME) ||
              spreadsheet.insertSheet(CONFIG.SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
       .setFontWeight('bold').setBackground('#d9e8fb');
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
  sheet.getRange(1, 4).setNote('Post title');
  return sheet;
}
