// The mood of what Orbit is saying, from its words: the strongest recent cue wins. Orbit's face shows it
// with its eyebrows and the light rings with their colour.
const MOODS={
  angry:/\b(angry|mad|furious|annoy\w*|grr+|hate|rage|outrage\w*|irritat\w*|frustrat\w*|grump\w*|how dare|unacceptable|ugh)\b/i,
  sad:/\b(sad|sorry|unfortunate\w*|miss(?:ed|ing)?|cry\w*|upset|lonely|bad news|regret\w*|disappoint\w*|heartbroken|oh no)\b/i,
  surprised:/\b(wow|whoa|woah|no way|really\?|surpris\w*|incredible|unbelievable|holy|what\?!?|oh my)\b/i,
  love:/\b(love|adore|sweet|cute|aww+|hug\w*|kind of you|thank you so much)\b/i,
  happy:/\b(great|awesome|happy|glad|wonderful|fantastic|yay|haha+|fun|excit\w*|amazing|congrat\w*|nice|cool|brilliant|perfect|hooray)\b/i,
};
export function detectMood(text){
  const recent=String(text||'').slice(-160);let best='neutral',at=-1;
  for(const [mood,pattern] of Object.entries(MOODS)){const re=new RegExp(pattern.source,'gi');let m;while((m=re.exec(recent)))if(m.index>=at){at=m.index;best=mood;}}
  return best;
}
