// Day 6: Trolley Problem Lab. The model, with no DOM code.
// Ten cases coded by seven features, six theories written as rules over those features,
// and a consistency check built from pairs of cases that differ in exactly one feature.

/**
 * The coded features. `easier` says which value makes an act easier to permit on every view coded here
 * ("more" for the number saved, otherwise the boolean value). `says` describes a value in a sentence.
 */
export const FEATURES = [
  { key: "saved", name: "the number of lives saved", easier: "more",
    says: (v) => `${v === 1 ? "one life is" : `${v.toLocaleString("en-GB")} lives are`} saved`,
    claim: "that a constraint against killing can be outweighed if enough lives are at stake. That is threshold deontology; none of the other five rules moves with the number." },
  { key: "means", name: "whether the death is a means or a side effect", easier: false,
    says: (v) => (v ? "the one's death is the means by which the others are saved" : "the one's death is a foreseen side effect"),
    claim: "that causing a death as the means to a good end is worse than causing it as a side effect. That is the core of the doctrine of double effect and of the Kantian constraint." },
  { key: "force", name: "whether you use your own physical force on the person", easier: false,
    says: (v) => (v ? "you use your own hands on him" : "you act at a distance, through a mechanism"),
    claim: "that killing with your own hands is worse than killing with a lever. None of the six rules says this. It is the pattern Greene and colleagues found in ordinary judgements, and most philosophers treat it as a fact about psychology, not a reason." },
  { key: "redirect", name: "whether an existing threat is redirected", easier: true,
    says: (v) => (v ? "an existing threat is turned away from the many" : "a new threat is made, or a person is moved into the threat's path"),
    claim: "that turning an existing threat onto fewer people differs from starting a new threat or moving someone into harm's way. That is Thomson's 1985 rights view." },
  { key: "duty", name: "a special obligation to the one", easier: false,
    says: (v) => (v ? "you owe the one a special duty that you do not owe the others" : "you owe the one nothing you do not owe the others"),
    claim: "that what you owe your own child differs from what you owe a stranger. None of the six rules gives this any weight: all of them are impartial." },
  { key: "agentThreat", name: "whether you would be the killer either way", easier: true,
    says: (v) => (v ? "you will be the one who kills whichever way it goes" : "if you do nothing you kill no one; you only fail to save"),
    claim: "that killing is worse than letting die, so the driver may steer where the bystander may not. That is Foot's distinction between negative and positive duties." },
  { key: "consent", name: "whether the one consents", easier: true,
    says: (v) => (v ? "the one asks you to do it" : "the one has not agreed"),
    claim: "that consent changes what may be done to a person. The Kantian constraint, the rights view and the killing rule agree; the doctrine of double effect does not." },
];

const base = { saved: 5, lost: 1, means: false, force: false, redirect: false, duty: false, agentThreat: false, consent: false };

/** The ten cases, in the order they are asked. `act` completes "Is it permissible to ...?" */
export const CASES = [
  { id: "driver", title: "The tram driver", source: "Philippa Foot, 1967", scene: "fork",
    text: "You are driving a tram and the brakes have failed. Five people are working on the track ahead and cannot get clear. You can steer onto a side track, where one person is working. Whichever way the tram goes, you are the one driving it.",
    act: "steer onto the side track", f: { ...base, redirect: true, agentThreat: true } },
  { id: "switch", title: "The switch", source: "Judith Jarvis Thomson, 1985, after Foot", scene: "fork",
    text: "A runaway trolley is heading for five people on the track. You are a passer-by standing next to a switch. If you throw it the trolley turns onto a side track, where it will kill one person instead. If you walk on, you have done nothing to anyone.",
    act: "throw the switch", f: { ...base, redirect: true } },
  { id: "loop", title: "The loop", source: "Thomson, 1985", scene: "loop",
    text: "As at the switch, with one change. The side track loops round and rejoins the main track behind the five. If the side track were empty, the trolley would come round and kill the five anyway. It is the one person's body that stops it.",
    act: "throw the switch", f: { ...base, redirect: true, means: true } },
  { id: "footbridge", title: "The footbridge", source: "Thomson, 1976 and 1985", scene: "bridge",
    text: "You are on a footbridge over the track, between the trolley and the five. Beside you stands a large stranger. The only way to stop the trolley is to push him off the bridge into its path. He will be killed and the five will live. You are too light to stop it yourself.",
    act: "push the stranger", f: { ...base, means: true, force: true } },
  { id: "trapdoor", title: "The trapdoor", source: "The remote footbridge of Greene and colleagues, 2009", scene: "trapdoor",
    text: "The stranger is standing on a trapdoor in the footbridge. You are some way off, next to a lever that opens it. If you pull the lever he drops into the trolley's path and stops it. You never touch him.",
    act: "pull the lever", f: { ...base, means: true } },
  { id: "volunteer", title: "The volunteer", source: "A consent variant of the trapdoor", scene: "trapdoor",
    text: "The trapdoor again, with one change. The stranger can see what is about to happen and cannot reach the lever himself. He shouts to you to pull it.",
    act: "pull the lever", f: { ...base, means: true, consent: true } },
  { id: "station", title: "The crowded station", source: "A numbers variant of the footbridge", scene: "bridge",
    text: "The footbridge again, with one change. The trolley is carrying fuel and is heading for a crowded station, where a thousand people will be killed if it arrives. Pushing the stranger into its path is still the only way to stop it.",
    act: "push the stranger", f: { ...base, saved: 1000, means: true, force: true } },
  { id: "child", title: "Your own child", source: "A variant of the switch that changes who is on the track", scene: "fork",
    text: "The switch again, with one change. The one person on the side track is your own child.",
    act: "throw the switch", f: { ...base, redirect: true, duty: true } },
  { id: "transplant", title: "The transplant", source: "Thomson, 1976 and 1985, after Foot", scene: "transplant",
    text: "You are a surgeon. Five of your patients will die today without transplants: one needs a heart, two a lung each, two a kidney each. A healthy visitor has come in for a check-up and is a match for all five. He has not agreed to anything. You could operate, take the organs and save the five. He would die.",
    act: "take the organs", f: { ...base, means: true, force: true } },
  { id: "gas", title: "The hospital gas", source: "Foot, 1967", scene: "gas",
    text: "Five patients in a hospital can be saved by making a certain gas. Making it will release lethal fumes into the next room, where there is one patient who cannot be moved. The fumes do nothing for the five: they are a by-product.",
    act: "make the gas", f: { ...base } },
];

const kantian = (f) => !(f.means && !f.consent);
export const THRESHOLD = 100;

/** Six theories as rules over the coded features. `permits(f)` is the verdict; `rule` is the same rule in words. */
export const THEORIES = [
  { key: "util", name: "Act utilitarianism", short: "Utilitarian",
    rule: "Permissible exactly when acting saves more lives than it costs. Nothing else counts.",
    permits: (f) => f.saved > f.lost },
  { key: "kant", name: "Kantian means constraint", short: "Kantian",
    rule: "Not permissible when a person's death is the means of saving the others and he has not agreed to it. Otherwise permissible.",
    permits: kantian },
  { key: "dde", name: "Doctrine of double effect", short: "Double effect",
    rule: "Permissible only when the death is a foreseen side effect, not a means, and more lives are saved than lost. Consent does not change this.",
    permits: (f) => !f.means && f.saved > f.lost },
  { key: "rights", name: "Rights view (Thomson, 1985)", short: "Rights",
    rule: "Permissible when the act only redirects an existing threat onto fewer people, or when the one consents. Making a new threat, or moving a person into the threat, infringes his rights.",
    permits: (f) => f.consent || (f.redirect && f.saved > f.lost) },
  { key: "kld", name: "Killing versus letting die (Foot, 1967)", short: "Killing rule",
    rule: "Not permissible to kill one person, without his consent, to save others whom you would otherwise only be failing to save. Permissible when you would be the killer either way and you kill fewer.",
    permits: (f) => f.consent || (f.agentThreat && f.saved > f.lost) },
  { key: "threshold", name: "Threshold deontology", short: "Threshold",
    rule: `The Kantian constraint, except that it gives way when at least ${THRESHOLD} lives are saved for each life lost. The number ${THRESHOLD} is arbitrary; the theory does not supply one.`,
    permits: (f) => kantian(f) || f.saved >= THRESHOLD * f.lost },
];

export const caseById = (id) => CASES.find((c) => c.id === id);
export const featureByKey = (key) => FEATURES.find((x) => x.key === key);

/** A theory's verdicts on all ten cases, as an answers object { caseId: true | false }. */
export function answersOf(theoryKey) {
  const t = THEORIES.find((x) => x.key === theoryKey);
  if (!t) return {};
  return Object.fromEntries(CASES.map((c) => [c.id, t.permits(c.f)]));
}

const isAnswer = (v) => v === true || v === false;

/** How each theory fits the answers given so far. share is null when nothing has been answered. */
export function score(answers = {}) {
  return THEORIES.map((t) => {
    const done = CASES.filter((c) => isAnswer(answers[c.id]));
    const misses = done.filter((c) => t.permits(c.f) !== answers[c.id]).map((c) => c.id);
    const matched = done.length - misses.length;
    return { key: t.key, name: t.name, short: t.short, answered: done.length, matched, share: done.length ? matched / done.length : null, misses };
  });
}

/** The theories with the highest share of matching answers (several when tied). Empty before the first answer. */
export function closest(answers = {}) {
  const s = score(answers).filter((x) => x.share != null);
  if (!s.length) return [];
  const best = Math.max(...s.map((x) => x.share));
  return s.filter((x) => x.share === best);
}

/**
 * Pairs of cases whose coding differs in exactly one feature (`pairs`: { easier, harder, feature }),
 * and pairs coded identically (`twins`: { a, b }).
 */
export function comparePairs(cases = CASES) {
  const pairs = [], twins = [];
  for (let i = 0; i < cases.length; i++) for (let j = i + 1; j < cases.length; j++) {
    const a = cases[i], b = cases[j];
    const diff = FEATURES.filter((x) => a.f[x.key] !== b.f[x.key]);
    if (!diff.length && a.f.lost === b.f.lost) twins.push({ a: a.id, b: b.id });
    if (diff.length !== 1 || a.f.lost !== b.f.lost) continue;
    const x = diff[0];
    const aEasier = x.easier === "more" ? a.f[x.key] > b.f[x.key] : a.f[x.key] === x.easier;
    pairs.push({ easier: aEasier ? a.id : b.id, harder: aEasier ? b.id : a.id, feature: x.key });
  }
  return { pairs, twins };
}

export const { pairs: PAIRS, twins: TWINS } = comparePairs();

/**
 * What the answers commit the visitor to.
 *   lines:     pairs answered "permissible" for the easier case and "not" for the harder one. The feature is doing the work.
 *   reversals: pairs answered the other way round, which no rule here can produce.
 *   twins:     identically coded cases answered differently.
 *   uneven:    a feature that decides one pair but is ignored in another where both acts were permitted.
 *   checked:   how many of the pairs and twins have both answers in.
 */
export function consistency(answers = {}) {
  const both = (p, q) => isAnswer(answers[p]) && isAnswer(answers[q]);
  const lines = [], reversals = [], uneven = [];
  let checked = 0;
  for (const p of PAIRS) {
    if (!both(p.easier, p.harder)) continue;
    checked++;
    if (answers[p.easier] && !answers[p.harder]) lines.push(p);
    else if (!answers[p.easier] && answers[p.harder]) reversals.push(p);
  }
  const twins = TWINS.filter((t) => both(t.a, t.b) && (checked++, answers[t.a] !== answers[t.b]));
  for (const line of lines) {
    for (const p of PAIRS) {
      if (p.feature === line.feature && p !== line && both(p.easier, p.harder) && answers[p.easier] && answers[p.harder]) uneven.push({ feature: p.feature, decides: line, ignored: p });
    }
  }
  return { lines, reversals, twins, uneven, checked, total: PAIRS.length + TWINS.length, features: [...new Set(lines.map((l) => l.feature))] };
}

/** Counts over all 2^10 complete sets of answers: how many have no reversal and no split twin, and how many of those also have no uneven line. */
export function countCoherent() {
  const n = CASES.length;
  let noReversal = 0, clean = 0;
  for (let mask = 0; mask < 2 ** n; mask++) {
    const answers = Object.fromEntries(CASES.map((c, i) => [c.id, Boolean(mask & (1 << i))]));
    const c = consistency(answers);
    if (c.reversals.length || c.twins.length) continue;
    noReversal++;
    if (!c.uneven.length) clean++;
  }
  return { total: 2 ** n, noReversal, clean };
}

/** The cases on which every theory gives the same verdict. */
export function unanimous() {
  return CASES.filter((c) => new Set(THEORIES.map((t) => t.permits(c.f))).size === 1).map((c) => c.id);
}
