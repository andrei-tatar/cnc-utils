import { Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import {
  Scene,
  OrthographicCamera,
  WebGLRenderer,
  TextureLoader,
  MeshBasicMaterial,
  Mesh,
  PlaneGeometry,
  DoubleSide,
  BoxGeometry,
  Vector2,
  Raycaster,
  Vector3,
  Camera,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Component({
  selector: 'app-cube-preview',
  standalone: true,
  imports: [],
  template: `<canvas #cubeCanvas></canvas>`,
  styles: `
    :host {
      display: block;
    }

    canvas {
      width: 100%;
      height: 100%;
    }
  `,
})
export class CubePreviewComponent implements OnInit {
  @ViewChild('cubeCanvas', { static: true })
  cubeCanvas!: ElementRef<HTMLCanvasElement>;

  @Input()
  camera!: Camera;

  @Input()
  controls!: OrbitControls;

  ngOnInit(): void {
    let cubeCameraDistance = 1.75;

    let cubeScene = new Scene();
    let cubeCamera = new OrthographicCamera();
    let cubeRenderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      canvas: this.cubeCanvas.nativeElement,
    });

    cubeRenderer.setSize(
      this.cubeCanvas.nativeElement.clientWidth,
      this.cubeCanvas.nativeElement.clientHeight,
    );
    cubeRenderer.setPixelRatio(window.devicePixelRatio);

    const updateCubeCamera = () => {
      cubeCamera.rotation.copy(this.camera.rotation);
      let dir = this.camera.position
        .clone()
        .sub(this.controls.target)
        .normalize();
      cubeCamera.position.copy(dir.multiplyScalar(cubeCameraDistance));
    };

    let materials: MeshBasicMaterial[] = [];
    let texts = ['RIGHT', 'LEFT', 'BACK', 'FRONT', 'TOP', 'BOTTOM'];

    let textureLoader = new TextureLoader();
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d')!;

    let size = 64;
    canvas.width = size;
    canvas.height = size;

    let mainColor = '#333';
    let otherColor = '#111';

    let bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, mainColor);
    bg.addColorStop(1, otherColor);

    for (let i = 0; i < texts.length; i++) {
      ctx.reset();

      let angle: number | null = null;
      switch (texts[i]) {
        case 'BOTTOM':
        case 'BACK':
          angle = 180;
          break;
        case 'LEFT':
          angle = 90;
          break;
        case 'RIGHT':
          angle = -90;
          break;
      }

      if (typeof angle === 'number') {
        const m = new DOMMatrix()
          .translate(size / 2, size / 2)
          .rotate(angle)
          .translate(-size / 2, -size / 2);
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      }

      ctx.font = 'bolder 12px "Open sans", Arial';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      if (texts[i] == 'TOP') {
        ctx.fillStyle = mainColor;
      } else if (texts[i] == 'BOTTOM') {
        ctx.fillStyle = otherColor;
      } else {
        ctx.fillStyle = bg;
      }

      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#aaa';
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, size, size);
      ctx.fillStyle = '#999';
      ctx.fillText(texts[i], size / 2, size / 2);
      materials.push(
        new MeshBasicMaterial({
          map: textureLoader.load(canvas.toDataURL()),
        }),
      );
    }

    const planes: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];

    let planeMaterial = new MeshBasicMaterial({
      side: DoubleSide,
      color: 0x00c0ff,
      transparent: true,
      opacity: 0,
      depthTest: false,
    });
    let planeSize = 0.7;
    let planeGeometry = new PlaneGeometry(planeSize, planeSize);

    let a = 0.51;

    let plane1 = new Mesh(planeGeometry, planeMaterial.clone());
    plane1.position.z = a;
    cubeScene.add(plane1);
    planes.push(plane1);

    let plane2 = new Mesh(planeGeometry, planeMaterial.clone());
    plane2.position.z = -a;
    cubeScene.add(plane2);
    planes.push(plane2);

    let plane3 = new Mesh(planeGeometry, planeMaterial.clone());
    plane3.rotation.y = Math.PI / 2;
    plane3.position.x = a;
    cubeScene.add(plane3);
    planes.push(plane3);

    let plane4 = new Mesh(planeGeometry, planeMaterial.clone());
    plane4.rotation.y = Math.PI / 2;
    plane4.position.x = -a;
    cubeScene.add(plane4);
    planes.push(plane4);

    let plane5 = new Mesh(planeGeometry, planeMaterial.clone());
    plane5.rotation.x = Math.PI / 2;
    plane5.position.y = a;
    cubeScene.add(plane5);
    planes.push(plane5);

    let plane6 = new Mesh(planeGeometry, planeMaterial.clone());
    plane6.rotation.x = Math.PI / 2;
    plane6.position.y = -a;
    cubeScene.add(plane6);
    planes.push(plane6);

    let cube = new Mesh(new BoxGeometry(1, 1, 1), materials);
    cubeScene.add(cube);

    let activePlane: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
    cubeRenderer.domElement.onmousemove = (evt) => {
      if (activePlane) {
        activePlane.material.opacity = 0;
        activePlane.material.needsUpdate = true;
        activePlane = null;
      }

      let x = evt.offsetX;
      let y = evt.offsetY;
      let size = cubeRenderer.getSize(new Vector2());
      let mouse = new Vector2(
        (x / size.width) * 2 - 1,
        (-y / size.height) * 2 + 1,
      );

      let raycaster = new Raycaster();
      raycaster.setFromCamera(mouse, cubeCamera);
      let intersects = raycaster.intersectObjects([...planes, cube]);

      if (intersects.length > 0 && intersects[0].object != cube) {
        activePlane = intersects[0].object as any;
        activePlane!.material.opacity = 0.2;
        activePlane!.material.needsUpdate = true;
      }
    };

    let oldPosition = new Vector3();
    let newPosition = new Vector3();
    cubeRenderer.domElement.onclick = (evt) => {
      cubeRenderer.domElement.onmousemove?.(evt);

      if (!activePlane) {
        return;
      }

      oldPosition.copy(this.camera.position);

      let distance = this.camera.position
        .clone()
        .sub(this.controls.target)
        .length();
      newPosition.copy(this.controls.target);

      if (activePlane.position.x !== 0) {
        newPosition.x += activePlane.position.x < 0 ? -distance : distance;
      } else if (activePlane.position.y !== 0) {
        newPosition.y += activePlane.position.y < 0 ? -distance : distance;
      } else if (activePlane.position.z !== 0) {
        newPosition.z += activePlane.position.z < 0 ? -distance : distance;
      }

      this.camera.position.copy(newPosition);
      this.controls.update();
    };

    cubeRenderer.setAnimationLoop(() => {
      cubeRenderer.render(cubeScene, cubeCamera);
      updateCubeCamera();
    });
  }
}
