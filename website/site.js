document.querySelectorAll('[data-gallery]').forEach(gallery=>{
  const tabs=[...gallery.querySelectorAll('[role=tab]')];
  function select(tab){
    tabs.forEach(t=>{t.setAttribute('aria-selected',String(t===tab));t.tabIndex=t===tab?0:-1});
    const panel=gallery.querySelector('[role=tabpanel]');
    panel.setAttribute('aria-labelledby',tab.id);
    panel.querySelector('img').src=tab.dataset.image;
    panel.querySelector('img').alt=tab.dataset.caption;
    panel.querySelector('figcaption').textContent=tab.dataset.caption;
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>select(tab));
    tab.addEventListener('keydown',event=>{
      let next;
      if(event.key==='ArrowRight') next=(index+1)%tabs.length;
      if(event.key==='ArrowLeft') next=(index+tabs.length-1)%tabs.length;
      if(event.key==='Home') next=0;
      if(event.key==='End') next=tabs.length-1;
      if(next!==undefined){event.preventDefault();select(tabs[next]);tabs[next].focus()}
    });
  });
});
const viewer=document.getElementById('image-viewer');
document.querySelectorAll('[data-zoom]').forEach(button=>button.addEventListener('click',()=>{
  const source=button.querySelector('img');
  viewer.querySelector('img').src=source.src;
  viewer.querySelector('img').alt=source.alt;
  viewer.querySelector('p').textContent=button.closest('figure').querySelector('figcaption')?.textContent||source.alt;
  const original=viewer.querySelector('.viewer-original');
  if(original) original.href=source.src;
  viewer.showModal();document.body.classList.add('no-scroll');
}));
viewer.querySelector('button').addEventListener('click',()=>viewer.close());
viewer.addEventListener('close',()=>document.body.classList.remove('no-scroll'));
viewer.addEventListener('click',event=>{if(event.target===viewer){const r=viewer.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)viewer.close()}});

let screenOrientation='lying',screenCategory='all';
function filterScreens(){let shown=0;document.querySelectorAll('[data-screen-orientation]').forEach(card=>{const visible=card.dataset.screenOrientation===screenOrientation&&(screenCategory==='all'||card.dataset.screenCategory===screenCategory);card.hidden=!visible;if(visible)shown++});const count=document.getElementById('screen-count');if(count)count.textContent=shown+' screens · '+(screenOrientation==='lying'?'Landscape':'Portrait');document.querySelectorAll('[data-orientation]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.orientation===screenOrientation)));document.querySelectorAll('[data-category]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===screenCategory)))}
document.querySelectorAll('[data-orientation]').forEach(button=>button.addEventListener('click',()=>{screenOrientation=button.dataset.orientation;filterScreens()}));document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{screenCategory=button.dataset.category;filterScreens()}));
