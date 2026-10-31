import * as THREE from 'three';

/** Moving version of the village generator saucers, with a belly hatch and ramp. */
export class SquadTransport {
  constructor(parent, position) {
    this.mesh = new THREE.Group();
    this.mesh.name = 'Alien transport saucer';
    const hull = new THREE.MeshStandardMaterial({ color: 0x586b73, metalness: .72, roughness: .35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x243d43, metalness: .7, roughness: .4 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x39dc9c, emissive: 0x29c98d, emissiveIntensity: 1.4 });
    const add = (geometry, material, x=0,y=0,z=0) => {
      const mesh = new THREE.Mesh(geometry,material); mesh.position.set(x,y,z);
      mesh.castShadow=true; mesh.receiveShadow=true; this.mesh.add(mesh); return mesh;
    };
    const profile=[[0,0],[3.6,0],[9,.72],[12,1.44],[12,1.56],[11.52,1.92],[8.64,2.52],[4.2,3],[0,3.12]];
    add(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),40),hull);
    const rim=add(new THREE.TorusGeometry(12,.09,6,64),glow,0,1.5);rim.rotation.x=Math.PI/2;
    const dome=add(new THREE.SphereGeometry(3.6,24,12,0,Math.PI*2,0,Math.PI/2),glow,0,3);
    dome.scale.y=.67;
    for(let i=0;i<4;i++) {
      const angle=Math.PI/4+i*Math.PI/2,x=Math.sin(angle)*7,z=Math.cos(angle)*7;
      add(new THREE.CylinderGeometry(.22,.32,3,8),dark,x,-1.5,z);
      add(new THREE.CylinderGeometry(.8,.8,.2,12),dark,x,-2.9,z);
    }
    for(let i=0;i<16;i++) {
      const angle=i*Math.PI/8;
      add(new THREE.BoxGeometry(.5,.18,.3),glow,Math.sin(angle)*11.85,1.65,Math.cos(angle)*11.85);
    }
    add(new THREE.CylinderGeometry(1.5,1.5,.1,20),glow,0,-.04,0);
    const ramp=add(new THREE.BoxGeometry(2.8,.18,11),dark,0,-1.5,-6.8);
    ramp.rotation.x=-Math.atan2(3,11);
    this.mesh.position.copy(position); parent.add(this.mesh);
  }
  dispose() {
    this.mesh.removeFromParent();
    const materials=new Set();
    this.mesh.traverse(node=>{node.geometry?.dispose();if(node.material)materials.add(node.material);});
    materials.forEach(m=>m.dispose());
  }
}
