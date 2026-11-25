import assert from "node:assert/strict";
import { DefaultScheduler, Rating } from "ts-fsrs";

const now = new Date("2026-11-25T08:00:00Z");
const scheduler = await DefaultScheduler({
  version: "FSRS-7",
  desiredRetention: 0.9,
  enableFuzz: false,
});
const initial = scheduler.newCard({ now });
const initialJSON = JSON.stringify(initial);
const preview = [...scheduler.preview({ card: initial, now })];
assert.equal(preview.length, 4);

const again = scheduler.review({ card: initial, grade: Rating.Again, now });
const good = scheduler.review({ card: initial, grade: Rating.Good, now });
assert.equal(JSON.stringify(initial), initialJSON);
assert.ok(+new Date(again.card.dueAt) > +now);
assert.ok(+new Date(good.card.dueAt) >= +new Date(again.card.dueAt));
assert.deepEqual(good, scheduler.review({ card: initial, grade: Rating.Good, now }));
assert.deepEqual(good.card, preview.find((item) => item.grade === Rating.Good).card);
assert.equal(good.revlog.rating, Rating.Good);
assert.equal(good.card.cardId, initial.cardId);
assert.equal(good.revlog.cardId, initial.cardId);

console.log(
  JSON.stringify(
    {
      algorithm: "FSRS-7",
      testedPackage: "ts-fsrs@6.0.1",
      gradedOptions: preview.length,
      againDueUtc: again.card.dueAt,
      goodDueUtc: good.card.dueAt,
      passed: true,
    },
    null,
    2,
  ),
);
