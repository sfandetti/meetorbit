import test from 'node:test';
import assert from 'node:assert/strict';
import {detectMood} from './mood.mjs';
test('the reply mood follows the latest emotional words',()=>{
  assert.equal(detectMood('Sure, here you go.'),'neutral');
  assert.equal(detectMood('That is awesome news!'),'happy');
  assert.equal(detectMood('Grr, that makes me so mad.'),'angry');
  assert.equal(detectMood("I'm sorry to hear that."),'sad');
  assert.equal(detectMood('Wow, no way!'),'surprised');
  assert.equal(detectMood('Aww, I love that.'),'love');
  assert.equal(detectMood('Sorry, I missed that... oh wait, that is great!'),'happy');
});
