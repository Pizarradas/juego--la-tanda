/* Bundle mínimo para el POC Tanda de penaltis V3.
   three.js r186 (MIT, https://threejs.org) + GLTFLoader + SkeletonUtils.clone.
   Regenerar (con three@0.186.1 instalado):
   esbuild three-penaltis.entrada.js --bundle --format=esm --minify --legal-comments=eof --outfile=three-penaltis.min.js */
export { ACESFilmicToneMapping,AdditiveBlending,AnimationClip,AnimationMixer,BoxGeometry,BufferAttribute,BufferGeometry,CanvasTexture,Color,CylinderGeometry,DirectionalLight,Float32BufferAttribute,Fog,Group,HemisphereLight,IcosahedronGeometry,InstancedMesh,LineBasicMaterial,LineSegments,Matrix4,Mesh,MeshBasicMaterial,MeshLambertMaterial,MeshStandardMaterial,PCFShadowMap,PerspectiveCamera,PlaneGeometry,Points,PointsMaterial,Quaternion,QuaternionKeyframeTrack,RepeatWrapping,SRGBColorSpace,Scene,SphereGeometry,SpotLight,Sprite,SpriteMaterial,Vector2,Vector3,WebGLRenderer } from 'three';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
