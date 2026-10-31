// Files used by the three campaign levels and their character selection/overlays.
// Fetching them before the prologue makes the progress bar represent real network work.
const FILES = [
  'menu-island.webp', 'inside-spaceship.glb', 'alien-level1.glb', 'Mr-overalls.glb',
  'Door-sliding-up.glb', 'Door-sliding-sideways.glb', 'Big-door-sliding-up.glb',
  'battleship-and-colliders.glb', 'forest/coastal-pine.glb',
  ...['deadpool','ashe','firion','junker-queen','bob','gorr','galiant','alien-reptilian',
    'distortus-rex','heavy-bot','elite-afton','bahamut-nt','bahamut-xvi'].map(name=>`characters/${name}.glb`),
  ...['deadpool','ashe','firion','junker-queen','bob','gorr'].map(name=>`animations/${name}.json`),
  ...['bishop','deadpool','ashe','firion','junker-queen','bob'].map(name=>`portraits/${name}.png`)
];

export async function preloadCampaignAssets(onProgress=()=>{}, fetchAsset=fetch) {
  const base=import.meta.env?.BASE_URL || '/';
  let next=0,completed=0;
  const partial=new Array(3).fill(0);
  const report=(label)=>onProgress((completed+partial.reduce((a,b)=>a+b,0))/FILES.length,label);
  report('Preparing assets');
  await Promise.all(partial.map(async (_,worker)=>{
    while(next<FILES.length){
      const file=FILES[next++];
      const response=await fetchAsset(`${base}assets/${file}`,{cache:'force-cache'});
      if(!response.ok)throw new Error(`Could not load ${file} (${response.status})`);
      const size=Number(response.headers.get('content-length')) || 0;
      if(response.body && size){
        const reader=response.body.getReader();
        let bytes=0;
        while(true){
          const {done,value}=await reader.read();
          if(done)break;
          bytes+=value.byteLength;
          partial[worker]=Math.min(.99,bytes/size);
          report(`Loading ${file}`);
        }
      }else await response.arrayBuffer();
      partial[worker]=0;completed++;
      report(`Loaded ${completed} of ${FILES.length} assets`);
    }
  }));
  onProgress(1,'Ready');
}
