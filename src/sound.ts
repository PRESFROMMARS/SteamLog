import type {Cue} from '../electron/types';

let context:AudioContext|undefined;
export async function unlockAudio(){
 context??=new AudioContext();
 if(context.state==='suspended')await context.resume();
}

const errorTone:[number,number,number][]=[[260,0,.07],[260,.11,.07],[260,.22,.07]];
const tones:Record<Cue,[number,number,number][]>={
 SUCCESS_SALE:[[1150,0,.055]],
 MODIFIER_SET:[[700,0,.055],[1050,.07,.055]],
 SPECIAL_RECORDED:[[880,0,.09],[880,.14,.09]],
 UNDO_OK:[[950,0,.09],[550,.12,.12]],
 ERROR_UNKNOWN_SKU:errorTone,
 SCAN_FAILED:errorTone,
};
export function play(cue:Cue){
 const schedule=()=>{
  if(!context||context.state!=='running')return;
  const audio=context;
  for(const [hz,offset,duration] of tones[cue]){
   const oscillator=audio.createOscillator(),gain=audio.createGain();
   oscillator.type=tones[cue]===errorTone?'sawtooth':'sine';
   oscillator.frequency.value=hz;
   const start=audio.currentTime+offset;
   gain.gain.setValueAtTime(0,start);
   gain.gain.linearRampToValueAtTime(.12,start+.004);
   gain.gain.setValueAtTime(.12,start+duration-.008);
   gain.gain.linearRampToValueAtTime(0,start+duration);
   oscillator.connect(gain);
   gain.connect(audio.destination);
   oscillator.start(start);
   oscillator.stop(start+duration);
   oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }
 };
 if(context?.state==='running')schedule();
 else void unlockAudio().then(schedule).catch(()=>{});
}
