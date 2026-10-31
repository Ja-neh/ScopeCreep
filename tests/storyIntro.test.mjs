import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryIntro } from '../src/ui/components/StoryIntro.js';

class FakeClassList {
  values=new Set();
  add(value){this.values.add(value);}
  remove(value){this.values.delete(value);}
  contains(value){return this.values.has(value);}
}

class FakeElement {
  classList=new FakeClassList();
  children=[];
  style={};
  hidden=false;
  textContent='';
  selectors=new Map();
  setAttribute(){}
  querySelector(selector){
    if(!this.selectors.has(selector))this.selectors.set(selector,new FakeElement());
    return this.selectors.get(selector);
  }
  append(...children){this.children.push(...children);}
  appendChild(child){this.children.push(child);return child;}
  addEventListener(){}
  focus(){}
  remove(){}
}

test('Level 1 opening continues automatically if the briefing button is missed', async () => {
  const originalDocument=globalThis.document;
  const originalSetTimeout=globalThis.setTimeout;
  const originalClearTimeout=globalThis.clearTimeout;
  let scheduled;
  globalThis.document={...(globalThis.document||{}),createElement:()=>new FakeElement()};
  globalThis.setTimeout=(callback,delay)=>{scheduled={callback,delay};return 42;};
  globalThis.clearTimeout=()=>{};

  try {
    const intro=new StoryIntro(new FakeElement());
    let onFinished;
    intro.attachCinematic({
      play(options){onFinished=options.onFinished;},
      hold(){},
      stop(){}
    });
    const started=intro.showLevel('Level01InsideSpaceship');
    onFinished();

    assert.equal(intro.continueButton.hidden,false,'Begin level remains available during the briefing');
    assert.match(intro.progress.textContent,/automatically in 5 seconds/i);
    assert.equal(scheduled.delay,5000);
    scheduled.callback();
    await started;
    assert.ok(intro.element.classList.contains('ui-hidden'),'the intro closes and releases level loading');
  } finally {
    globalThis.setTimeout=originalSetTimeout;
    globalThis.clearTimeout=originalClearTimeout;
    if(originalDocument)globalThis.document=originalDocument;
    else delete globalThis.document;
  }
});
