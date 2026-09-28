// Docker-style random names ("adjective_surname", e.g. "focused_lovelace"), used to stand in
// for team numbers in an anonymized report. Lists are drawn from Docker's names-generator,
// minus adjectives that would read as a judgement of a team in a shared report ("angry",
// "boring", "naughty"...).
const ADJECTIVES = [
  'admiring', 'adoring', 'affectionate', 'amazing', 'awesome', 'beautiful', 'blissful', 'bold',
  'brave', 'busy', 'charming', 'clever', 'compassionate', 'competent', 'confident', 'cool',
  'dazzling', 'determined', 'dreamy', 'eager', 'ecstatic', 'elastic', 'elated', 'elegant',
  'eloquent', 'epic', 'exciting', 'fervent', 'festive', 'flamboyant', 'focused', 'friendly',
  'frosty', 'funny', 'gallant', 'gifted', 'goofy', 'gracious', 'great', 'happy', 'hardcore',
  'heuristic', 'hopeful', 'hungry', 'inspiring', 'intelligent', 'interesting', 'jolly', 'jovial',
  'keen', 'kind', 'laughing', 'loving', 'lucid', 'magical', 'modest', 'musing', 'mystifying',
  'nice', 'nifty', 'nostalgic', 'objective', 'optimistic', 'peaceful', 'pedantic', 'pensive',
  'practical', 'priceless', 'quirky', 'quizzical', 'recursing', 'relaxed', 'reverent', 'romantic',
  'serene', 'sharp', 'silly', 'sleepy', 'stoic', 'sweet', 'tender', 'thirsty', 'trusting',
  'unruffled', 'upbeat', 'vibrant', 'vigilant', 'vigorous', 'wizardly', 'wonderful',
  'xenodochial', 'youthful', 'zealous', 'zen',
];

const SURNAMES = [
  'albattani', 'allen', 'archimedes', 'aryabhata', 'babbage', 'banach', 'bardeen', 'bartik',
  'bassi', 'bell', 'bhabha', 'bhaskara', 'blackburn', 'bohr', 'booth', 'bose', 'brahmagupta',
  'brattain', 'burnell', 'cannon', 'carson', 'cerf', 'chandrasekhar', 'chebyshev', 'clarke',
  'cori', 'cray', 'curie', 'darwin', 'davinci', 'dijkstra', 'easley', 'edison', 'einstein',
  'elion', 'engelbart', 'euclid', 'euler', 'faraday', 'fermat', 'fermi', 'feynman', 'franklin',
  'gagarin', 'galileo', 'galois', 'gauss', 'germain', 'goldberg', 'goodall', 'hamilton',
  'hawking', 'heisenberg', 'hermann', 'herschel', 'hertz', 'hodgkin', 'hopper', 'hypatia',
  'jackson', 'jennings', 'johnson', 'kalam', 'keller', 'kepler', 'khayyam', 'kilby', 'knuth',
  'lamarr', 'lamport', 'leakey', 'leavitt', 'liskov', 'lovelace', 'lumiere', 'maxwell',
  'mcclintock', 'meitner', 'mendel', 'mendeleev', 'mirzakhani', 'montalcini', 'morse', 'napier',
  'nash', 'newton', 'nightingale', 'noether', 'noyce', 'pascal', 'pasteur', 'payne', 'poincare',
  'ptolemy', 'raman', 'ramanujan', 'ride', 'ritchie', 'roentgen', 'rubin', 'saha', 'shannon',
  'shaw', 'shockley', 'snyder', 'stonebraker', 'sutherland', 'tesla', 'tharp', 'thompson',
  'torvalds', 'turing', 'vaughan', 'wilson', 'wing', 'wozniak', 'wright', 'wu', 'yalow', 'yonath',
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Maps each key to a unique random Docker-style name. Fresh every call, so two exports of
 *  the same event don't share names (and can't be cross-referenced). */
export function dockerNames(keys) {
  const used = new Set();
  const out = new Map();
  for (const k of keys) {
    let name;
    do name = `${pick(ADJECTIVES)}_${pick(SURNAMES)}`;
    while (used.has(name));
    used.add(name);
    out.set(k, name);
  }
  return out;
}
