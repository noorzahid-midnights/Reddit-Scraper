"""Tests for the rules that decide whether a post becomes a lead."""

import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from reddit_leads import dedupe, filters, pipeline  # noqa: E402

NOW = 1_700_000_000.0


def post(**overrides):
    base = {
        "id": "abc123",
        "title": "[Hiring] Remote AI engineer for LangChain RAG chatbot",
        "selftext": "We are hiring a fully remote AI engineer. Budget $6,000. " + "detail " * 80,
        "subreddit": "forhire",
        "author": "someclient",
        "created_utc": NOW - 2 * 86400,
        "permalink": "/r/forhire/comments/abc123/x/",
        "num_comments": 4,
    }
    base.update(overrides)
    return base


class TestRemoteVsOnsite(unittest.TestCase):
    def test_explicit_remote_passes(self):
        is_remote, evidence, _ = filters.classify_location(
            filters.normalize("Fully remote AI role, work from home"), "forhire")
        self.assertTrue(is_remote)
        self.assertIn("remote", evidence)

    def test_onsite_terms_rejected(self):
        for phrase in ["3 days in office", "hybrid role", "must be located in Berlin",
                       "willing to relocate", "in-person interviews and work",
                       "candidates must be local"]:
            is_remote, _, reason = filters.classify_location(
                filters.normalize("Remote-ish AI job. " + phrase), "forhire")
            self.assertFalse(is_remote, phrase)
            self.assertIn("onsite/hybrid marker", reason)

    def test_negated_onsite_still_remote(self):
        for phrase in ["no onsite", "not hybrid", "without relocation",
                       "no in-person meetings", "zero commute"]:
            is_remote, _, _ = filters.classify_location(
                filters.normalize("Remote AI job, " + phrase), "forhire")
            self.assertTrue(is_remote, phrase)

    def test_silence_is_not_remote(self):
        is_remote, _, reason = filters.classify_location(
            filters.normalize("AI engineer needed for our startup"), "forhire")
        self.assertFalse(is_remote)
        self.assertEqual(reason, "no explicit remote statement")

    def test_remote_only_subreddit_counts_as_evidence(self):
        is_remote, evidence, _ = filters.classify_location(
            filters.normalize("AI engineer needed"), "RemoteJobs")
        self.assertTrue(is_remote)
        self.assertIn("remote-only", evidence)


class TestAiRelevance(unittest.TestCase):
    def test_strong_terms_detected(self):
        score, strong, _ = filters.ai_relevance(
            filters.normalize("Need a LangChain RAG chatbot with embeddings"))
        self.assertGreater(score, 5)
        self.assertIn("langchain", strong)

    def test_no_false_positive_on_substrings(self):
        # "said" and "maintain" contain "ai" but are not AI work.
        score, strong, _ = filters.ai_relevance(
            filters.normalize("He said we should maintain the plain website"))
        self.assertEqual((score, strong), (0, []))

    def test_weak_terms_alone_need_company(self):
        self.assertFalse(filters.is_ai_related(filters.normalize("python developer")))
        self.assertTrue(filters.is_ai_related(filters.normalize("ai automation with n8n")))


class TestRecency(unittest.TestCase):
    def test_within_window(self):
        self.assertTrue(filters.is_recent(NOW - 13 * 86400, 14, NOW))

    def test_outside_window(self):
        self.assertFalse(filters.is_recent(NOW - 15 * 86400, 14, NOW))

    def test_future_timestamp_rejected(self):
        self.assertFalse(filters.is_recent(NOW + 86400, 14, NOW))


class TestSelfPromo(unittest.TestCase):
    def test_for_hire_posts_excluded(self):
        self.assertTrue(filters.is_seeking_work("[FOR HIRE] AI developer", "Hire me"))
        self.assertTrue(filters.is_seeking_work("For Hire - ML engineer", "my portfolio"))

    def test_hiring_posts_kept(self):
        self.assertFalse(filters.is_seeking_work("[Hiring] AI developer",
                                                 "We need someone remote"))


class TestPay(unittest.TestCase):
    def test_pay_formats(self):
        self.assertEqual(filters.extract_pay("budget is $2,500 total"), "$2,500")
        self.assertEqual(filters.extract_pay("paying $45/hr"), "$45/hr")
        self.assertEqual(filters.extract_pay("no numbers here"), "")


class TestDedupe(unittest.TestCase):
    def test_same_id_removed(self):
        leads = [{"post": post()}, {"post": post()}]
        kept, duplicates = dedupe.deduplicate(leads)
        self.assertEqual((len(kept), duplicates), (1, 1))

    def test_repost_by_same_author_removed(self):
        leads = [
            {"post": post(id="one")},
            {"post": post(id="two", created_utc=NOW - 5 * 86400)},
        ]
        kept, duplicates = dedupe.deduplicate(leads)
        self.assertEqual((len(kept), duplicates), (1, 1))

    def test_word_order_variation_removed(self):
        leads = [
            {"post": post(id="one",
                          title="Remote AI engineer wanted to build a support chatbot")},
            {"post": post(id="two", author="other",
                          title="Support chatbot: remote AI engineer wanted to build")},
        ]
        kept, duplicates = dedupe.deduplicate(leads)
        self.assertEqual((len(kept), duplicates), (1, 1))

    def test_generic_titles_from_different_authors_kept(self):
        # Two unrelated clients can word a short ad identically.
        leads = [
            {"post": post(id="one", author="clientA",
                          title="Looking for an AI developer")},
            {"post": post(id="two", author="clientB",
                          title="Looking for an AI developer")},
        ]
        kept, duplicates = dedupe.deduplicate(leads)
        self.assertEqual((len(kept), duplicates), (2, 0))

    def test_distinct_posts_kept(self):
        leads = [
            {"post": post(id="one", title="Remote AI engineer for chatbot")},
            {"post": post(id="two", author="other",
                          title="Remote computer vision contractor needed")},
        ]
        kept, duplicates = dedupe.deduplicate(leads)
        self.assertEqual((len(kept), duplicates), (2, 0))


class TestPipeline(unittest.TestCase):
    def test_end_to_end_filtering(self):
        posts = [
            post(id="good"),
            post(id="onsite", title="[Hiring] AI engineer, hybrid 3 days in office"),
            post(id="old", created_utc=NOW - 30 * 86400),
            post(id="forhire", title="[FOR HIRE] AI developer available"),
            post(id="notai", title="[Hiring] Remote virtual assistant for data entry",
                 selftext="Remote role, $10/hr, no AI involved here at all."),
            post(id="dup"),
        ]
        rows, stats = pipeline.build_leads(posts, 14, 20, now=NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(stats["duplicates_removed"], 1)
        self.assertEqual(rows[0]["work_location"], "Remote")
        self.assertEqual(rows[0]["pay_or_budget"], "$6,000")
        self.assertTrue(rows[0]["post_url"].startswith("https://www.reddit.com/r/forhire"))

    def test_limit_respected(self):
        posts = [post(id="p%d" % i, author="client%d" % i,
                      title="[Hiring] Remote AI engineer for project %d" % i)
                 for i in range(30)]
        rows, _ = pipeline.build_leads(posts, 14, 20, now=NOW)
        self.assertEqual(len(rows), 20)

    def test_rows_sorted_by_score(self):
        posts = [post(id="p%d" % i, author="client%d" % i,
                      title="[Hiring] Remote AI engineer for project %d" % i,
                      created_utc=NOW - i * 86400) for i in range(5)]
        rows, _ = pipeline.build_leads(posts, 14, 20, now=NOW)
        scores = [row["lead_score"] for row in rows]
        self.assertEqual(scores, sorted(scores, reverse=True))


if __name__ == "__main__":
    unittest.main(verbosity=2)
