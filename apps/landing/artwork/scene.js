const { THREE, RoomEnvironment } = window;
const canvas = document.querySelector('#sculpture'), stage = document.querySelector('#current');
const width = Number(stage.dataset.width), height = Number(stage.dataset.height);
const renderer = new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
renderer.setSize(width,height); renderer.setPixelRatio(1);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.05;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFShadowMap;
const scene=new THREE.Scene(); scene.background=new THREE.Color('#2459e8');
const camera=new THREE.PerspectiveCamera(34,width/height,.1,60);
camera.position.set(7,6,10); camera.lookAt(0,0,0);
const environment=new RoomEnvironment(), pmrem=new THREE.PMREMGenerator(renderer);
scene.environment=pmrem.fromScene(environment,.035).texture;
environment.dispose(); pmrem.dispose(); scene.environmentIntensity=.85;
const key=new THREE.DirectionalLight('#f5f4ef',2.4);
key.position.set(-4,7,5); key.castShadow=true; key.shadow.mapSize.set(2048,2048);
key.shadow.camera.left=key.shadow.camera.bottom=-6; key.shadow.camera.right=key.shadow.camera.top=6;
key.shadow.normalBias=.02; key.shadow.bias=-.0001; key.shadow.radius=5; scene.add(key);
const fill=new THREE.DirectionalLight('#dce6ff',1.4); fill.position.set(4,2,-4); scene.add(fill);
scene.add(new THREE.HemisphereLight('#f5f4ef','#2459e8',.7));

// Original broad bevelled ribbons; no downloaded models or textures.
function ribbonGeometry() {
  const positions=[],indices=[],profile=[];
  const halfWidth=.57,halfThickness=.075,bevel=.055;
  for(let corner=0;corner<4;corner++) {
    const angle=corner*Math.PI/2;
    const cx=Math.cos(angle+Math.PI/4)>0?halfWidth-bevel:-halfWidth+bevel;
    const cy=Math.sin(angle+Math.PI/4)>0?halfThickness-bevel:-halfThickness+bevel;
    for(let j=0;j<10;j++){const a=angle+j/9*Math.PI/2;profile.push([cx+Math.cos(a)*bevel,cy+Math.sin(a)*bevel]);}
  }
  const segments=320,count=profile.length;
  const center=t=>new THREE.Vector3(2.1*Math.cos(t),.42*Math.sin(2*t),1.5*Math.sin(t));
  for(let i=0;i<=segments;i++) {
    const t=i/segments*Math.PI*2,p=center(t);
    const tangent=center(t+.001).sub(center(t-.001)).normalize();
    const radial=new THREE.Vector3(Math.cos(t),0,Math.sin(t)).normalize();
    const perpendicular=new THREE.Vector3().crossVectors(tangent,radial).normalize();
    radial.crossVectors(perpendicular,tangent).normalize();
    const twist=t+.32*Math.sin(2*t);
    const width=radial.clone().multiplyScalar(Math.cos(twist)).addScaledVector(perpendicular,Math.sin(twist));
    const thickness=new THREE.Vector3().crossVectors(tangent,width).normalize();
    for(const[x,y]of profile){const point=p.clone().addScaledVector(width,x).addScaledVector(thickness,y);positions.push(point.x,point.y,point.z);}
    if(i<segments)for(let j=0;j<count;j++){const a=i*count+j,b=i*count+(j+1)%count;indices.push(a,b,b+count,a,b+count,a+count);}
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
const geometry=ribbonGeometry();
const silver=new THREE.MeshPhysicalMaterial({color:'#f5f4ef',metalness:1,roughness:.21,clearcoat:.55,clearcoatRoughness:.16,side:THREE.DoubleSide});
const cobalt=new THREE.MeshPhysicalMaterial({color:'#2459e8',metalness:.7,roughness:.2,clearcoat:1,clearcoatRoughness:.12,side:THREE.DoubleSide});
const sculpture=new THREE.Group(),first=new THREE.Mesh(geometry,silver),second=new THREE.Mesh(geometry,cobalt);
for(const mesh of[first,second]){mesh.castShadow=true;mesh.receiveShadow=true;sculpture.add(mesh);}
first.position.set(-.7,.3,0);first.rotation.set(.35,-.2,-.2);
second.position.set(.9,-.3,-.45);second.rotation.set(1.1,.4,-.4);second.scale.setScalar(.82);
sculpture.rotation.z=-.3;scene.add(sculpture);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshBasicMaterial({color:'#2459e8',toneMapped:false}));
floor.rotation.x=-Math.PI/2;floor.position.y=-2.35;floor.receiveShadow=true;scene.add(floor);
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({color:'#102967',opacity:.22}));
shadow.rotation.x=-Math.PI/2;shadow.position.y=-2.345;shadow.receiveShadow=true;scene.add(shadow);
function draw(){
  const phase=Number(stage.style.getPropertyValue('--phase'));
  sculpture.rotation.y=-.45+phase*1.1;
  sculpture.rotation.x=-.15+Math.sin(phase*Math.PI)*.16;
  first.rotation.y=-.2+phase*.3;second.rotation.y=.4-phase*.22;
  renderer.render(scene,camera);
}
draw();
const tl=gsap.timeline({paused:true});
tl.to(stage,{'--phase':1,duration:6.6,ease:'sine.inOut',onUpdate:draw},.2);
tl.from(canvas,{scale:1.06,duration:2,ease:'expo.out'},.2);
window.__currentTimeline=tl;
window.__renderArtwork=draw;
