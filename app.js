import * as THREE from './libs/three/three.module.js';
import { GLTFLoader } from './libs/three/jsm/GLTFLoader.js';
import { DRACOLoader } from './libs/three/jsm/DRACOLoader.js';
import { RGBELoader } from './libs/three/jsm/RGBELoader.js';
import { Stats } from './libs/stats.module.js';
import { LoadingBar } from './libs/LoadingBar.js';
import { VRButton } from './libs/VRButton.js';
import { CanvasUI } from './libs/CanvasUI.js';
import { GazeController } from './libs/GazeController.js';
import { XRControllerModelFactory } from './libs/three/jsm/XRControllerModelFactory.js';

class App {
    constructor() {
        const container = document.createElement('div');
        document.body.appendChild(container);

        this.assetsPath = './assets/';
        
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 500);
        this.camera.position.set(0, 1.6, 0);
        
        this.dolly = new THREE.Object3D();
        this.dolly.position.set(0, 0, 10);
        this.dolly.add(this.camera);
        this.dummyCam = new THREE.Object3D();
        this.camera.add(this.dummyCam);
        
        this.scene = new THREE.Scene();
        this.scene.add(this.dolly);
        
        const ambient = new THREE.HemisphereLight(0xFFFFFF, 0xAAAAAA, 0.8);
        this.scene.add(ambient);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        container.appendChild(this.renderer.domElement);
        this.setEnvironment();
    
        window.addEventListener('resize', this.resize.bind(this));
        
        this.clock = new THREE.Clock();
        this.up = new THREE.Vector3(0, 1, 0);
        this.origin = new THREE.Vector3();
        this.workingVec3 = new THREE.Vector3();
        this.workingQuaternion = new THREE.Quaternion();
        this.raycaster = new THREE.Raycaster();
        
        this.stats = new Stats();
        container.appendChild(this.stats.dom);
        
        this.loadingBar = new LoadingBar();
        
        this.loadCollege();
        
        this.immersive = false;
        
        const self = this;
        
        fetch('./college.json')
            .then(response => response.json())
            .then(obj => {
                self.boardShown = '';
                self.boardData = obj;
            });
    }
    
    setEnvironment() {
        const loader = new RGBELoader().setDataType(THREE.UnsignedByteType);
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();
        
        const self = this;
        
        loader.load('./assets/hdr/venice_sunset_1k.hdr', (texture) => {
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            
            // Apply a warm color tint
            const warmColor = new THREE.Color(0xFFDDC1); // Warm light color
            const colorFilter = new THREE.Color(1, 0.8, 0.6); // Tint color
            
            envMap.encoding = THREE.sRGBEncoding;
            self.scene.environment = envMap;

            // Apply tint to the environment map
            const envMapShader = new THREE.ShaderMaterial({
                uniforms: {
                    tEquirect: { value: envMap },
                    colorFilter: { value: colorFilter }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform sampler2D tEquirect;
                    uniform vec3 colorFilter;
                    varying vec2 vUv;
                    void main() {
                        vec4 texColor = texture2D(tEquirect, vUv);
                        gl_FragColor = vec4(texColor.rgb * colorFilter, texColor.a);
                    }
                `,
                side: THREE.BackSide
            });
            
            const skybox = new THREE.Mesh(
                new THREE.SphereGeometry(500, 60, 40),
                envMapShader
            );
            skybox.material.side = THREE.BackSide;
            self.scene.add(skybox);
            
            pmremGenerator.dispose();

        }, undefined, (err) => {
            console.error('An error occurred setting the environment');
        });
    }
    
    resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    loadCollege() {
        const loader = new GLTFLoader().setPath(this.assetsPath);
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('./libs/three/js/draco/');
        loader.setDRACOLoader(dracoLoader);
        
        const self = this;
        
        // Load a glTF resource
        loader.load(
            'college.glb',
            function (gltf) {
                const college = gltf.scene.children[0];
                self.scene.add(college);
                
                college.traverse(function (child) {
                    if (child.isMesh) {
                        if (child.name.indexOf("PROXY") != -1) {
                            child.material.visible = false;
                            self.proxy = child;
                        } else if (child.material.name.indexOf('Glass') != -1) {
                            child.material.opacity = 0.1;
                            child.material.transparent = true;
                        } else if (child.material.name.indexOf("SkyBox") != -1) {
                            const mat1 = child.material;
                            const mat2 = new THREE.MeshBasicMaterial({ map: mat1.map });
                            child.material = mat2;
                            mat1.dispose();
                        }
                    }
                });
                
                const door1 = college.getObjectByName("LobbyShop_Door__1_");
                const door2 = college.getObjectByName("LobbyShop_Door__2_");
                const pos = door1.position.clone().sub(door2.position).multiplyScalar(0.5).add(door2.position);
                const obj = new THREE.Object3D();
                obj.name = "LobbyShop";
                obj.position.copy(pos);
                college.add(obj);
                
                self.loadingBar.visible = false;
            
                self.setupXR();
            },
            function (xhr) {
                self.loadingBar.progress = (xhr.loaded / xhr.total);
            },
            function (error) {
                console.log('An error happened');
            }
        );
    }
    
    setupXR() {
        this.renderer.xr.enabled = true;

        const btn = new VRButton(this.renderer);
        
        const self = this;
        
        const timeoutId = setTimeout(connectionTimeout, 2000);
        
        function onSelectStart(event) {
            this.userData.selectPressed = true;
        }

        function onSelectEnd(event) {
            this.userData.selectPressed = false;
        }
        
        function onConnected(event) {
            clearTimeout(timeoutId);
        }
        
        function connectionTimeout() {
            self.useGaze = true;
            self.gazeController = new GazeController(self.scene, self.dummyCam);
        }
        
        this.controllers = this.buildControllers(this.dolly);
        
        this.controllers.forEach((controller) => {
            controller.addEventListener('selectstart', onSelectStart);
            controller.addEventListener('selectend', onSelectEnd);
            controller.addEventListener('connected', onConnected);
        });
        
        const config = {
            panelSize: { height: 0.5 },
            height: 256,
            name: { fontSize: 50, height: 70 },
            info: { position: { top: 70, backgroundColor: "#ccc", fontColor: "#000" } }
        };
        const content = {
            name: "name",
            info: "info"
        };
        
        this.ui = new CanvasUI(content, config);
        this.scene.add(this.ui.mesh);
        
        this.renderer.setAnimationLoop(this.render.bind(this));
    }
    
    buildControllers(parent = this.scene) {
        const controllerModelFactory = new XRControllerModelFactory();

        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);

        const line = new THREE.Line(geometry);
        line.scale.z = 0;
        
        const controllers = [];
        
        for (let i = 0; i <= 1; i++) {
            const controller = this.renderer.xr.getController(i);
            controller.add(line.clone());
            controller.userData.selectPressed = false;
            parent.add(controller);
            controllers.push(controller);
            
            const grip = this.renderer.xr.getControllerGrip(i);
            grip.add(controllerModelFactory.createControllerModel(grip));
            parent.add(grip);
        }
        
        return controllers;
    }
    
    moveDolly(dt) {
        if (this.proxy === undefined) return;
        
        const wallLimit = 1.3;
        const speed = 2;
        let pos = this.dolly.position.clone();
        pos.y += 1;
        
        let dir = new THREE.Vector3();
        this.dolly.getWorldDirection(dir);
        dir.y = 0;
        dir.normalize();
        
        if (this.dolly.position.z > (this.proxy.position.z + wallLimit) || this.dolly.position.z < (this.proxy.position.z - wallLimit)) {
            if (this.dolly.position.x > (this.proxy.position.x + wallLimit) || this.dolly.position.x < (this.proxy.position.x - wallLimit)) {
                dir.z = dir.x = 0;
            } else {
                dir.x = 0;
            }
        } else {
            dir.z = 0;
        }
        
        this.dolly.position.add(dir.multiplyScalar(dt * speed));
    }
    
    render() {
        const delta = this.clock.getDelta();
        this.moveDolly(delta);
        this.stats.update();
        this.renderer.render(this.scene, this.camera);
    }
}

const app = new App();
