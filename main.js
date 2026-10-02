import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 1. Setup Scene, Camera, and Renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 16, 22); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 2. Add Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(10, 20, 10);
scene.add(directionalLight);

// 3. Setup Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; 
controls.dampingFactor = 0.05;

// 4. Interaction Setup
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const draggableObjects = [];
const environmentObjects = []; 
let selectedObject = null;
let currentMode = 'empty'; // Tracks the current active mode

// --- Custom Graphics Function to mimic Onshape ---
function applyCADStyle(model, isCup = false, isClear = false) {
    model.traverse((node) => {
        if (node.isMesh) {
            if (node.material) {
                node.material = node.material.clone(); 
                node.material.roughness = 0.8;
                node.material.metalness = 0.1;
                node.material.polygonOffset = true;
                node.material.polygonOffsetFactor = 1;
                node.material.polygonOffsetUnits = 1;

                if (isCup) {
                    if (isClear) {
                        node.material.transparent = true;
                        node.material.opacity = 0.4; 
                        node.material.depthWrite = false; // Fixes internal pin rendering
                    } else {
                        node.material.color.setHex(0x222222); // Solid dark grey half
                    }
                }
            }
            
            const edges = new THREE.EdgesGeometry(node.geometry, 30); 
            // Give clear plastic lighter edges, everything else gets solid black
            const edgeColor = (isCup && isClear) ? 0x555555 : 0x000000; 
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: edgeColor }));
            line.raycast = function () {};
            node.add(line);
        }
    });
}

// 5. Load the 3D Assets
const loader = new GLTFLoader();

loader.load('assets/field-base.glb', function (gltf) {
    const fieldModel = gltf.scene;
    fieldModel.scale.set(10, 10, 10); 
    fieldModel.rotation.x = -Math.PI / 2; 
    fieldModel.position.set(0, 0, 0); 
    applyCADStyle(fieldModel);
    scene.add(fieldModel);
    environmentObjects.push(fieldModel); 
}, undefined, function (error) {
    console.error('Error loading the field:', error);
});

const prefabs = {};

function loadPrefab(name, filename) {
    loader.load(`assets/${filename}`, function(gltf) {
        const model = gltf.scene;
        model.scale.set(10, 10, 10); 
        model.rotation.x = -Math.PI / 2;
        applyCADStyle(model, false, false); // Standard pins are not cups
        prefabs[name] = model;
    }, undefined, function (error) {
        console.error(`Error loading ${filename}:`, error);
    });
}

// Special Asynchronous Loader for the Split Cup
Promise.all([
    loader.loadAsync('assets/Cup_Clear.glb'),
    loader.loadAsync('assets/Cup_Solid.glb')
]).then(([clearGltf, solidGltf]) => {
    // Create an empty container for the unified cup
    const cupGroup = new THREE.Group();
    cupGroup.scale.set(10, 10, 10);
    cupGroup.rotation.x = -Math.PI / 2;

    // Apply clear styles and add to container
    const clearModel = clearGltf.scene;
    applyCADStyle(clearModel, true, true); 
    cupGroup.add(clearModel);

    // Apply solid styles and add to container
    const solidModel = solidGltf.scene;
    applyCADStyle(solidModel, true, false);
    cupGroup.add(solidModel);

    // Register the unified group as our 'cup' prefab!
    prefabs['cup'] = cupGroup;
}).catch(error => console.error("Error loading the split cup files:", error));

// Load standard pins
loadPrefab('pinRY', 'pin-red-yellow.glb');
loadPrefab('pinBY', 'pin-blue-yellow.glb');
loadPrefab('pinYY', 'pin-yellow-yellow.glb');
loadPrefab('pinRB', 'pin-red-blue.glb');

// C. Load the Toggles
const toggleObjects = []; 

function spawnToggle(x, z, wallRotationY) {
    loader.load('assets/toggle.glb', function (gltf) {
        const toggleModel = gltf.scene;
        toggleModel.scale.set(15, 10, 15); 
        toggleModel.rotation.x = -Math.PI / 2; 
        
        const pivotGroup = new THREE.Group();
        pivotGroup.position.set(x, 3, z);
        pivotGroup.rotation.y = wallRotationY;
        pivotGroup.add(toggleModel);
        pivotGroup.userData.state = 0;
        
        applyCADStyle(pivotGroup);
        scene.add(pivotGroup);
        toggleObjects.push(pivotGroup);
    }, undefined, function (error) {
        console.error('Error loading the toggle:', error);
    });
}

// Spawn all 4 toggles using clean container rotations
spawnToggle(18, 0, 0);                 // Right Wall
spawnToggle(-18, 0, Math.PI);          // Left Wall
spawnToggle(0, 18, Math.PI / 2);       // Top Wall
spawnToggle(0, -18, Math.PI / 2);      // Bottom Wall

loadPrefab('cup', 'cup.glb');
loadPrefab('pinRY', 'pin-red-yellow.glb');
loadPrefab('pinBY', 'pin-blue-yellow.glb');
loadPrefab('pinYY', 'pin-yellow-yellow.glb');
loadPrefab('pinRB', 'pin-red-blue.glb');

// --- 6. ADVANCED MODE MANAGER ---
function spawnSpecificObject(prefabName, x, z, y = 0.8, isHorizontal = false, rotY = 0) {
    if (prefabs[prefabName]) {
        const clone = prefabs[prefabName].clone();
        clone.userData.isLyingDown = isHorizontal;
        
        // THIS IS THE FIX: The scoreboard needs this to know what color the pin is!
        clone.userData.prefabName = prefabName; 
        
        // If horizontal, lower the height to 0.4 so it rests on the floor
        clone.userData.yOffset = isHorizontal ? 0.4 : y; 
        clone.userData.type = prefabName === 'cup' ? 'cup' : 'pin';
        clone.position.set(x, clone.userData.yOffset, z); 
        
        if (isHorizontal) {
            clone.rotation.x = 0; // Lays the pin flat
            clone.rotation.y = rotY; // Points the pin in a specific compass direction
        }
        
        scene.add(clone);
        draggableObjects.push(clone); 
        
        return clone; // <-- ADD THIS LINE so we can manipulate it after spawning
    }
    return null;
}

// NEW HELPER FUNCTION: Glues a piece to a cup so they drag as one solid unit
function tieToCup(cup, piece) {
    if (cup && piece) {
        cup.attach(piece); // Attaches piece to cup while keeping its exact world position
        
        // Remove the child piece from the draggable array so the raycaster only targets the parent cup
        const index = draggableObjects.indexOf(piece);
        if (index > -1) {
            draggableObjects.splice(index, 1);
        }
    }
}

function clearField() {
    draggableObjects.forEach(obj => scene.remove(obj));
    draggableObjects.length = 0;
}

function setMode(mode) {
    currentMode = mode;
    
    // Clear pieces if switching away from Game Ready or if Empty is requested
    if (mode === 'empty' || mode === 'gameready') {
        clearField();
    }

    if (mode === 'gameready') {
        // --- GAME READY POPULATION SCRIPT ---
        
       // 1. Cups (with a Vertical Pin inside)
        const cupPinCoords = [
            {x: 0, z: 6, flipToRed: false},   // Bottom (Blue visible)
            {x: -6, z: 0, flipToRed: false},  // Left (Blue visible)
            {x: 0, z: -6, flipToRed: true},   // Top (Red visible)
            {x: 6, z: 0, flipToRed: true},    // Right (Red visible)
        ];
        
        cupPinCoords.forEach(pos => {
            let cup = spawnSpecificObject('cup', pos.x, pos.z, 0.8);
            
            // Spawn the pin and capture the returned 3D object
            let pin = spawnSpecificObject('pinRB', pos.x, pos.z, 1.6); 
            
            // If this pin is supposed to show Red, flip it upside down!
            if (pin && pos.flipToRed) {
                pin.rotation.x = Math.PI / 2;
            }

            // Tie the pin to the cup
            tieToCup(cup, pin);
        });

      // 2. Horizontal Pin Clusters (4-way stars)
        // Shifted to the double white line diagonal (bottom-left to top-right)
        const starCoords = [
            {x: -12, z: -12}, {x: -6, z: -6}, 
            {x: 6, z: 6}, {x: 12, z: 12}
        ];
        
        starCoords.forEach(pos => {
            // Spawn the base cup that the star rests on
            let cup = spawnSpecificObject('cup', pos.x, pos.z, 0.8);

            // Spawn the 4 pins
            let p1 = spawnSpecificObject('pinRY', pos.x + 1.2, pos.z, 1.6, true, Math.PI / 2);
            let p2 = spawnSpecificObject('pinBY', pos.x - 1.2, pos.z, 1.6, true, -Math.PI / 2);
            let p3 = spawnSpecificObject('pinBY', pos.x, pos.z + 1.2, 1.6, true, 0);
            let p4 = spawnSpecificObject('pinRY', pos.x, pos.z - 1.2, 1.6, true, -Math.PI);

            // Tie all 4 pins to the center cup
            tieToCup(cup, p1);
            tieToCup(cup, p2);
            tieToCup(cup, p3);
            tieToCup(cup, p4);
        });

        // 4. Single Line Cups & Pins (Outer Diagonals)
        const singleLineCoords = [
            {x: 6, z: -6}, {x: 12, z: -12},  // Top-Right single line
            {x: -6, z: 6}, {x: -12, z: 12}   // Bottom-Left single line
        ];
        
        singleLineCoords.forEach(pos => {
            // Spawn the base cup
            let cup = spawnSpecificObject('cup', pos.x, pos.z, 0.8);
            
            // Spawn the Yellow/Yellow pin sitting inside it
            let pin = spawnSpecificObject('pinYY', pos.x, pos.z, 1.6);

            // Tie the pin to the cup
            tieToCup(cup, pin);
        });

        // 5. Perimeter Wall Cups (Groups of 3)
        // Located against the top and bottom walls, centered on X=-6 and X=6 tile seams
        const wallGroups = [
            {cx: -6, cz: -17}, 
            {cx: 6, cz: -17},  
            {cx: -6, cz: 17},        
            {cx: 6, cz: 17}          
        ];
        
        wallGroups.forEach(group => {
            // Center cup with the Yellow/Yellow pin inside
            let centerCup = spawnSpecificObject('cup', group.cx, group.cz, 0.8);
            if (centerCup) centerCup.rotation.x = Math.PI / 2; // Flips upside down

            let pin = spawnSpecificObject('pinYY', group.cx, group.cz, 1.6);
            tieToCup(centerCup, pin); // Tie the pin to the center cup
            
            // Right empty cup
            let rightCup = spawnSpecificObject('cup', group.cx + 0.8, group.cz, 0.8);
            if (rightCup) rightCup.rotation.x = Math.PI / 2;
            
            // Left empty cup
            let leftCup = spawnSpecificObject('cup', group.cx - 0.8, group.cz, 0.8);
            if (leftCup) leftCup.rotation.x = Math.PI / 2;
        });

        // 6. Perimeter Wall Cups (Left and Right Walls)
        // Offset along the Z-axis so they lay flat against the side walls
        const sideWallGroups = [
            {cx: -17, cz: -6}, 
            {cx: -17, cz: 6},  
            {cx: 17, cz: -6},   
            {cx: 17, cz: 6}     
        ];
        
        sideWallGroups.forEach(group => {
            // Center cup with the Yellow/Yellow pin inside
            let centerCup = spawnSpecificObject('cup', group.cx, group.cz, 0.8);
            if (centerCup) centerCup.rotation.x = Math.PI / 2; // Flips upside down

            let pin = spawnSpecificObject('pinYY', group.cx, group.cz, 1.6);
            tieToCup(centerCup, pin); // Tie the pin to the center cup
            
            // "Top" empty cup (offset by -2 units along the Z axis)
            let topCup = spawnSpecificObject('cup', group.cx, group.cz - 0.8, 0.8);
            if (topCup) topCup.rotation.x = Math.PI / 2;
            
            // "Bottom" empty cup (offset by +2 units along the Z axis)
            let bottomCup = spawnSpecificObject('cup', group.cx, group.cz + 0.8, 0.8);
            if (bottomCup) bottomCup.rotation.x = Math.PI / 2;
        });
    }

    // UPDATE SCORE WHEN THE FIELD LOADS
    if (typeof calculateScores === 'function') calculateScores();
}
// --- LIVE SCORING SYSTEM ---
function calculateScores() {
    // Force Three.js to update global positions instantly
    scene.updateMatrixWorld(true);

    let redScore = 0;
    let blueScore = 0;

    // The FULL 9-Goal Array
    const goalPositions = [
        { x: 0, z: 0 }, 
        { x: 5.93, z: 11.85 }, { x: -5.93, z: -11.85 },
        { x: 11.85, z: 5.9 }, { x: -11.85, z: -5.93 }, 
        { x: 5.93, z: -11.85 }, { x: -5.93, z: 11.85 },
        { x: -11.85, z: 5.93 }, { x: 11.85, z: -5.93 }
    ];

    let allPins = [];
    let allCups = [];
    
    draggableObjects.forEach(obj => {
        if (obj.userData.type === 'pin') allPins.push(obj);
        if (obj.userData.type === 'cup') {
            allCups.push(obj);
            if (obj.children) {
                obj.children.forEach(child => {
                    if (child.userData && child.userData.type === 'pin') allPins.push(child);
                });
            }
        }
    });

    allPins.forEach(pin => {
        let worldPos = new THREE.Vector3();
        pin.getWorldPosition(worldPos);

        let scoredGoal = goalPositions.find(goal => {
            return Math.abs(worldPos.x - goal.x) < 0.5 && Math.abs(worldPos.z - goal.z) < 0.5;
        });

        if (scoredGoal) {
            
            // 1. FOOLPROOF ORIENTATION CHECK
            // Instead of fragile Euler angles, we push a vector "Up" and see if it points down!
            let pinQuat = new THREE.Quaternion();
            pin.getWorldQuaternion(pinQuat);
            let pinUp = new THREE.Vector3(0, 1, 0).applyQuaternion(pinQuat);
            let isUpsideDown = pinUp.y < 0;
            
            // 2. ASSIGN COLORS TO PHYSICAL HALVES
            let prefab = pin.userData.prefabName || '';
            let physicalTopColor = 'yellow';
            let physicalBottomColor = 'yellow';
            
            if (prefab.includes('RB')) { physicalTopColor = 'red'; physicalBottomColor = 'blue'; }
            else if (prefab.includes('RY')) { physicalTopColor = 'red'; physicalBottomColor = 'yellow'; }
            else if (prefab.includes('BY')) { physicalTopColor = 'blue'; physicalBottomColor = 'yellow'; }
            else if (prefab.includes('YY')) { physicalTopColor = 'yellow'; physicalBottomColor = 'yellow'; }

            // If the pin is flipped, the color that was on the bottom is now physically on top
            if (isUpsideDown) {
                let temp = physicalTopColor;
                physicalTopColor = physicalBottomColor;
                physicalBottomColor = temp;
            }

            // 3. PRECISE RULE <SC3> COVERAGE CHECKS
            // Find the exact spatial center of the Pin's top and bottom halves
            let pinY = worldPos.y;
            let pinTopCenter = pinY + 0.4;
            let pinBottomCenter = pinY - 0.4;

            let topCovered = false;
            let bottomCovered = false;

            allCups.forEach(cup => {
                let cupPos = new THREE.Vector3();
                cup.getWorldPosition(cupPos);

                // Only check cups stacked on the exact same goal column
                if (Math.abs(cupPos.x - worldPos.x) < 0.5 && Math.abs(cupPos.z - worldPos.z) < 0.5) {
                    
                    let cupQuat = new THREE.Quaternion();
                    cup.getWorldQuaternion(cupQuat);
                    let cupUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cupQuat);
                    let cupUpsideDown = cupUp.y < 0;

                    let cupY = cupPos.y;
                    
                    // The opaque base is at the bottom (-0.4) if upright, or at the top (+0.4) if upside-down
                    let cupOpaqueCenter = cupY + (cupUpsideDown ? 0.4 : -0.4);

                    // If the center of the pin half shares the same physical space as the opaque cup half, it's covered!
                    if (Math.abs(pinTopCenter - cupOpaqueCenter) < 0.35) topCovered = true;
                    if (Math.abs(pinBottomCenter - cupOpaqueCenter) < 0.35) bottomCovered = true;
                }
            });

            let isMidfield = (scoredGoal.x === 0 && scoredGoal.z === 0);

            // 4. SCORE EACH VISIBLE HALF INDEPENDENTLY
            function scoreHalf(color, isCovered) {
                if (isCovered) return; // Ignore covered halves completely
                
                // Alliance Pins score universally in Head-to-Head
                if (color === 'red') redScore += 5;
                if (color === 'blue') blueScore += 5;
                
                // Yellow Pins rely on Quadrant Toggles
                if (color === 'yellow' && !isMidfield) {
                    let nearestToggle = null;
                    let minDistance = Infinity;
                    
                    toggleObjects.forEach(t => {
                        let dist = Math.pow(t.position.x - scoredGoal.x, 2) + Math.pow(t.position.z - scoredGoal.z, 2);
                        if (dist < minDistance) {
                            minDistance = dist;
                            nearestToggle = t;
                        }
                    });
                    
                    if (nearestToggle) {
                        if (nearestToggle.userData.state === 1) blueScore += 10;
                        if (nearestToggle.userData.state === 2) redScore += 10;
                    }
                }
            }

            scoreHalf(physicalTopColor, topCovered);
            scoreHalf(physicalBottomColor, bottomCovered);
        }
    });

    const redUI = document.getElementById('score-red');
    const blueUI = document.getElementById('score-blue');
    if (redUI) redUI.innerText = redScore;
    if (blueUI) blueUI.innerText = blueScore;
}


// --- 7. UI EVENT LISTENERS ---
// Toolbox buttons
document.getElementById('spawn-cup')?.addEventListener('click', () => spawnSpecificObject('cup', 0, 5));
document.getElementById('spawn-ry')?.addEventListener('click', () => spawnSpecificObject('pinRY', 0, 5));
document.getElementById('spawn-by')?.addEventListener('click', () => spawnSpecificObject('pinBY', 0, 5));
document.getElementById('spawn-yy')?.addEventListener('click', () => spawnSpecificObject('pinYY', 0, 5));
document.getElementById('spawn-rb')?.addEventListener('click', () => spawnSpecificObject('pinRB', 0, 5));

// Mode buttons
document.getElementById('mode-empty')?.addEventListener('click', () => setMode('empty'));
document.getElementById('mode-gameready')?.addEventListener('click', () => setMode('gameready'));
document.getElementById('mode-drawing')?.addEventListener('click', () => setMode('drawing'));

// Retractable Menu Toggle
const toggleMenuBtn = document.getElementById('toggle-menu');
const menuContent = document.getElementById('menu-content');
if (toggleMenuBtn && menuContent) {
    toggleMenuBtn.addEventListener('click', () => {
        menuContent.style.display = (menuContent.style.display === 'none') ? 'block' : 'none';
    });
}


// --- 8. DRAG AND DROP LOGIC ---
window.addEventListener('pointerdown', (event) => {
    // Disable dragging pieces when in drawing mode
    if (currentMode === 'drawing') return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(draggableObjects, true);

    if (intersects.length > 0) {
        let rootObj = intersects[0].object;
        while (rootObj.parent && rootObj.parent !== scene) {
            rootObj = rootObj.parent;
        }
        selectedObject = rootObj;
        controls.enabled = false; 
    }
});

window.addEventListener('pointermove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(environmentObjects, true);

    if (intersects.length > 0) {
        const hitPoint = intersects[0].point;
        
        const coordsDisplay = document.getElementById('coords');
        if(coordsDisplay) coordsDisplay.innerText = `X: ${hitPoint.x.toFixed(1)} | Z: ${hitPoint.z.toFixed(1)}`;

        if (selectedObject && currentMode !== 'drawing') {
            selectedObject.position.x = hitPoint.x;
            selectedObject.position.z = hitPoint.z;
            selectedObject.position.y = selectedObject.userData.yOffset;
        }
    }
});

window.addEventListener('pointerup', () => {
    if (selectedObject && currentMode !== 'drawing') {
        let snapRadius = 3; 
        let targetX = null;
        let targetZ = null;
        let isStaticGoal = false;
        let goalBaseHeight = null;
        
        // Your original V5RC field static stake coordinates
        const goalPositions = [
            { x: 0, z: 0, yOffset: 2.25 }, 
            { x: 5.93, z: 11.85, yOffset: 1.5 },
            { x: -5.93, z: -11.85, yOffset: 1.5 },
            { x: 11.85, z: 5.9, yOffset: 1.5 }, 
            { x: -11.85, z: -5.93, yOffset: 1.5 }, 
            { x: 5.93, z: -11.85, yOffset: 0.8 },
            { x: -5.93, z: 11.85, yOffset: 0.8 },
            { x: -11.85, z: 5.93, yOffset: 0.8 }, 
            { x: 11.85, z: -5.93, yOffset: 0.8 } 
        ];

        for (let i = 0; i < goalPositions.length; i++) {
            let goal = goalPositions[i];
            let dx = selectedObject.position.x - goal.x;
            let dz = selectedObject.position.z - goal.z;
            
            if (Math.sqrt(dx * dx + dz * dz) < snapRadius) {
                targetX = goal.x;
                targetZ = goal.z;
                isStaticGoal = true;
                goalBaseHeight = goal.yOffset;
                break;
            }
        }

        let closestTarget = null;
        if (!isStaticGoal) {
            let minDistance = snapRadius;
            for (let i = 0; i < draggableObjects.length; i++) {
                let target = draggableObjects[i];
                if (target === selectedObject) continue;

                let dx = selectedObject.position.x - target.position.x;
                let dz = selectedObject.position.z - target.position.z;
                let distance = Math.sqrt(dx * dx + dz * dz);

                if (distance < minDistance) {
                    minDistance = distance;
                    targetX = target.position.x;
                    targetZ = target.position.z;
                }
            }
        }

        if (targetX !== null) {
            let stack = [];
            for (let i = 0; i < draggableObjects.length; i++) {
                let piece = draggableObjects[i];
                if (piece === selectedObject) continue;
                
                if (Math.abs(piece.position.x - targetX) < 0.1 && 
                    Math.abs(piece.position.z - targetZ) < 0.1) {
                    stack.push(piece);
                    closestTarget = piece; // Capture for dynamic glue
                }
            }

            let isValidMove = true;
            let finalY = 0.8; 

            // YOUR ORIGINAL FLAWLESS HEIGHT LOGIC (Restored!)
            if (stack.length === 0) {
                if (isStaticGoal) {
                    // Removed the goalAccepts strictness, but kept your height offset logic
                    finalY = selectedObject.userData.type === 'cup' ? goalBaseHeight + 0.8 : goalBaseHeight;
                }
            } else {
                // Finds the true top of the stack (even if it has a glued pin hidden inside it!)
                let topPiece = stack.reduce((max, piece) => {
                    let pHeight = piece.userData.yOffset + (piece.children.some(c => c.userData && c.userData.type === 'pin') ? 0.8 : 0);
                    let mHeight = max.userData.yOffset + (max.children.some(c => c.userData && c.userData.type === 'pin') ? 0.8 : 0);
                    return pHeight > mHeight ? piece : max;
                }, stack[0]);
                
                let trueTop = topPiece.userData.yOffset + (topPiece.children.some(c => c.userData && c.userData.type === 'pin') ? 0.8 : 0);
                finalY = trueTop + 0.8;
            }

            if (isValidMove) {
                selectedObject.position.x = targetX;
                selectedObject.position.z = targetZ;
                selectedObject.userData.yOffset = finalY;
                selectedObject.position.y = finalY;
                
                // DYNAMIC GLUE: Tie loose pins to cups if dropped on them
                if (!isStaticGoal && closestTarget && closestTarget.userData.type === 'cup' && selectedObject.userData.type === 'pin') {
                    closestTarget.attach(selectedObject);
                    const idx = draggableObjects.indexOf(selectedObject);
                    if (idx > -1) draggableObjects.splice(idx, 1);
                }
            }
        }

        selectedObject = null;
        controls.enabled = true; 
    }

    // SCORING TRIGGER
    if (typeof calculateScores === 'function') calculateScores();
});


// --- 9. DOUBLE-CLICK INTERACTIONS ---
window.addEventListener('dblclick', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Part 1: Flip Game Pieces
    const pieceIntersects = raycaster.intersectObjects(draggableObjects, true);
    if (pieceIntersects.length > 0) {
        let rootObj = pieceIntersects[0].object;
        while (rootObj.parent && rootObj.parent !== scene) {
            rootObj = rootObj.parent;
        }
        
        // Initialize the rotation state if it doesn't exist yet based on current angle
        if (rootObj.userData.flipState === undefined) {
            if (rootObj.rotation.x < -1.5) rootObj.userData.flipState = 0;      // -90 deg (Upright)
            else if (rootObj.rotation.x > 1.5) rootObj.userData.flipState = 2;  // +90 deg (Upside Down)
            else rootObj.userData.flipState = 1;                                // 0 deg (Flat)
        }
        
        // Detect if this is a cup that has a pin glued inside of it
        let hasAttachedPin = false;
        if (rootObj.userData.type === 'cup') {
            rootObj.traverse((child) => {
                if (child !== rootObj && child.userData && child.userData.type === 'pin') {
                    hasAttachedPin = true;
                }
            });
        }
        
        // Advance to the next state in the 4-step cycle
        rootObj.userData.flipState = (rootObj.userData.flipState + 1) % 4;
        
        switch (rootObj.userData.flipState) {
            case 0: // State 0: Standing Upright
                rootObj.rotation.x = -Math.PI / 2; 
                rootObj.userData.isLyingDown = false;
                rootObj.userData.yOffset = 0.8; 
                break;
            case 1: // State 1: Laying Flat
                rootObj.rotation.x = 0; 
                rootObj.userData.isLyingDown = true;
                rootObj.userData.yOffset = 0.4; 
                break;
            case 2: // State 2: Standing Upside Down (Inverted stack)
                rootObj.rotation.x = Math.PI / 2; 
                rootObj.userData.isLyingDown = false;
                // If it has a pin, lift it to 1.6 so the pin rests on the floor. Otherwise, keep it at 0.8.
                rootObj.userData.yOffset = hasAttachedPin ? 1.6 : 0.8; 
                break;
            case 3: // State 3: Laying Flat (Opposite direction)
                rootObj.rotation.x = Math.PI; 
                rootObj.userData.isLyingDown = true;
                rootObj.userData.yOffset = 0.4; 
                break;
        }
        
        rootObj.position.y = rootObj.userData.yOffset;
        return; 
    }

    // Part 2: Toggle Rotation
    const toggleIntersects = raycaster.intersectObjects(toggleObjects, true);
    if (toggleIntersects.length > 0) {
        let clickedObj = toggleIntersects[0].object;
        while (clickedObj.parent && clickedObj.parent !== scene && !toggleObjects.includes(clickedObj)) {
            clickedObj = clickedObj.parent;
        }
        
        let targetToggle = toggleObjects.includes(clickedObj) ? clickedObj : null;
        if (targetToggle) {
            const toggleDegrees = [0, 120, -120]; 
            targetToggle.userData.state = (targetToggle.userData.state + 1) % 3;
            
            const angleInRadians = toggleDegrees[targetToggle.userData.state] * (Math.PI / 180);
            const innerModel = targetToggle.children.find(child => child.type === 'Group' || child.type === 'Scene');
            if (innerModel) {
                innerModel.rotation.y = angleInRadians;
            }
        }
    }
   if (typeof calculateScores === 'function') calculateScores();
});
// 10. Handle Keyboard Rotation
window.addEventListener('keydown', (event) => {
    const spherical = new THREE.Spherical().setFromVector3(camera.position);
    const rotationSpeed = 0.05;

    switch (event.key) {
        case 'ArrowLeft': spherical.theta -= rotationSpeed; break;
        case 'ArrowRight': spherical.theta += rotationSpeed; break;
        case 'ArrowUp': spherical.phi = Math.max(0.1, spherical.phi - rotationSpeed); break;
        case 'ArrowDown': spherical.phi = Math.min(Math.PI / 2, spherical.phi + rotationSpeed); break;
    }

    camera.position.setFromSpherical(spherical);
    controls.update();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
    requestAnimationFrame(animate);
    controls.update(); 
    renderer.render(scene, camera);
}

animate();

