import unittest

from score import score


class ScoreTest(unittest.TestCase):
    def test_correct_value_and_anchor_still_need_semantic_support(self):
        actual = [
            {"targetId": "a", "value": "5", "claim": "Five with the wrong condition.",
             "evidence": {"spanId": "source"}},
            {"targetId": "b", "value": "0", "claim": "Zero.", "evidence": {"spanId": "source"}},
        ]
        gold = [
            {"targetId": "a", "value": "5", "evidenceId": "source"},
            {"targetId": "b", "value": "0", "evidenceId": "source"},
            {"targetId": "c", "value": "1", "evidenceId": "source"},
        ]
        self.assertEqual(score(actual, gold, {"a": False, "b": True}), {
            "expected": 3, "submitted": 2, "correct": 1, "valueAndAnchorCorrect": 2,
            "precision": 0.5, "recall": 1 / 3,
            "outcomes": {"a": "semantic-failure", "b": "correct", "c": "missing"},
        })

    def test_a_semantic_review_cannot_make_wrong_evidence_correct(self):
        actual = [{"targetId": "a", "value": "5", "claim": "Five.", "evidence": {"spanId": "wrong"}}]
        gold = [{"targetId": "a", "value": "5", "evidenceId": "right"}]
        self.assertEqual(score(actual, gold, {"a": True})["outcomes"], {"a": "value-or-anchor-failure"})


if __name__ == "__main__":
    unittest.main()
