"""Classification rules: is this post AI work, is it paid, and is it remote?

Matching is word-boundary based so that "ai" does not fire on "said" or
"maintain", and onsite detection is negation-aware so that a post saying
"remote, no onsite" is not thrown away as an onsite job.
"""

import re
import time

from . import config

_WORD_CACHE = {}


def _pattern(term):
    """Compile a word-boundary pattern for a term, tolerating inner spacing."""
    if term not in _WORD_CACHE:
        escaped = re.escape(term).replace(r"\ ", r"\s+")
        # \b does not work next to punctuation like "[hiring]" or "a.i.", so
        # only anchor the sides that start/end with a word character.
        left = r"\b" if term[:1].isalnum() else ""
        right = r"\b" if term[-1:].isalnum() else ""
        _WORD_CACHE[term] = re.compile(left + escaped + right, re.IGNORECASE)
    return _WORD_CACHE[term]


def normalize(text):
    """Lowercase and collapse whitespace so patterns match across line breaks."""
    return re.sub(r"\s+", " ", (text or "").replace("’", "'")).strip().lower()


def find_terms(text, terms):
    """Return the terms that appear in text, longest match first."""
    hits = []
    for term in terms:
        if _pattern(term).search(text):
            hits.append(term)
    # Prefer the most specific phrasing when terms overlap ("ai engineer" > "ai").
    hits.sort(key=len, reverse=True)
    return hits


def _is_negated(text, match_start):
    """True when a negation word sits just before an onsite mention."""
    window = text[max(0, match_start - 30):match_start]
    for negation in config.NEGATION_PREFIXES:
        if re.search(r"\b" + re.escape(negation) + r"\b[\s\-–—,:()\"']*$", window):
            return True
    return False


def onsite_signals(text):
    """Onsite/hybrid terms that are *not* negated. Any hit disqualifies a lead."""
    signals = []
    for term in config.ONSITE_TERMS:
        for match in _pattern(term).finditer(text):
            if not _is_negated(text, match.start()):
                signals.append(term)
                break
    return signals


def remote_signals(text):
    """Explicit remote/work-from-anywhere evidence."""
    return find_terms(text, config.REMOTE_TERMS)


def classify_location(text, subreddit):
    """Decide remote vs onsite.

    Returns (is_remote, evidence, reason). The rule is deliberately strict:
    a lead must show positive remote evidence AND carry no live onsite marker.
    Silence is not treated as remote, except in subreddits whose own rules
    make every post remote.
    """
    onsite = onsite_signals(text)
    if onsite:
        return False, "", "onsite/hybrid marker: " + ", ".join(onsite[:3])

    remote = remote_signals(text)
    if remote:
        return True, ", ".join(remote[:3]), ""

    if subreddit.lower() in config.REMOTE_BY_DEFAULT_SUBREDDITS:
        return True, "r/%s is remote-only by subreddit rule" % subreddit, ""

    return False, "", "no explicit remote statement"


def ai_relevance(text):
    """Score how much this post is about AI work.

    Strong terms stand on their own; weak terms only add once a strong term
    has already established that the post is AI work.
    """
    strong = find_terms(text, config.AI_TERMS_STRONG)
    weak = find_terms(text, config.AI_TERMS_WEAK)
    score = len(strong) * 3
    if strong:
        score += min(len(weak), 4)
    elif len(weak) >= 2:
        # No strong term, but several weak ones ("ai" + "automation" + "n8n").
        score += 2
    return score, strong, weak


def is_ai_related(text):
    score, strong, _ = ai_relevance(text)
    return bool(strong) or score >= 2


def hiring_signals(text):
    return find_terms(text, config.HIRING_TERMS)


def self_promo_signals(text):
    """Detect posts where the author is selling, not buying."""
    return find_terms(text, config.SELF_PROMO_TERMS)


def is_seeking_work(title, body):
    """True for [FOR HIRE]-style posts, which are not leads for us."""
    title_n = normalize(title)
    if re.match(r"^\s*[\[\(]?\s*(for\s*hire|available|hire\s*me)\b", title_n):
        return True
    if find_terms(title_n, ["[for hire]", "[forhire]", "[available]", "hire me"]):
        return True
    # A body that is all self-promotion with no hiring intent.
    body_n = normalize(body)
    if self_promo_signals(body_n) and not hiring_signals(title_n + " " + body_n):
        return True
    return False


PAY_PATTERN = re.compile(
    r"(\$\s?\d[\d,.]*\s*(?:k|,000)?(?:\s*(?:-|–|to)\s*\$?\s?\d[\d,.]*\s*k?)?"
    r"(?:\s*(?:/|per\s+)(?:hr|hour|h|day|week|month|mo|year|yr|project))?"
    r"|\d[\d,.]*\s*(?:usd|eur|gbp|cad|aud)\b"
    r"|\b\d{2,3}\s*(?:/|per\s+)(?:hr|hour)\b)",
    re.IGNORECASE,
)


def extract_pay(text):
    """Pull the first money-looking string out of the post, if any."""
    match = PAY_PATTERN.search(text or "")
    if not match:
        return ""
    # The number pattern happily swallows a sentence-ending "." or ",".
    return re.sub(r"\s+", " ", match.group(0)).strip().rstrip(".,")


def lead_type(text):
    """Label the lead as an employment-style job or a one-off project/gig."""
    return "job" if find_terms(text, config.JOB_TERMS) else "project/gig"


def age_days(created_utc, now=None):
    now = time.time() if now is None else now
    return (now - float(created_utc)) / 86400.0


def is_recent(created_utc, max_age_days=config.DEFAULT_MAX_AGE_DAYS, now=None):
    age = age_days(created_utc, now)
    return 0 <= age <= max_age_days
