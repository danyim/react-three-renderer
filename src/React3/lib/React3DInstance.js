import THREE from 'three';
import invariant from 'fbjs/lib/invariant.js';
import Viewport from './Viewport';
import ResourceContainer from './Resources/ResourceContainer';
import ReactUpdates from 'react/lib/ReactUpdates';


import CameraUtils from './utils/CameraUtils';

import React3Renderer from '../lib/React3Renderer';

const rendererProperties = [
  'gammaInput',
  'gammaOutput',
];

class React3DInstance {
  constructor(props, rendererInstance:React3Renderer) {
    const {
      mainCamera,
      canvas,
      width,
      height,
      onAnimate,
      antialias,
      onRecreateCanvas,
      } = props;

    this._parameters = {...props};

    this._rendererInstance = rendererInstance;

    this._mounted = false;
    this._scene = null;
    this._highlightScene = new THREE.Scene();

    this._highlightGeometry = new THREE.BoxGeometry(1, 1, 1);
    this._highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0x0000ff,
      transparent: true,
      opacity: 0.4,
    });

    this._highlightObjectId = null;
    this._getHighlightBoundingBox = null;

    this._mainCameraName = mainCamera;
    this._viewports = [];
    this._resourceContainers = [];
    this._canvas = canvas;
    this._antialias = antialias;
    this._recreateCanvasCallback = onRecreateCanvas;
    this._width = width;
    this._height = height;

    this._createRenderer(this._parameters);

    this._onAnimate = onAnimate;
    this._objectsByUUID = {};
    this._materials = [];
    this._geometries = [];
    this._textures = [];
    this._objectsByName = {};

    this._lastRenderMode = null;

    this._renderRequest = requestAnimationFrame(this._render);

    this.userData = {};
  }

  _createRenderer(parameters) {
    this._renderer = new THREE.WebGLRenderer({canvas: this._canvas, antialias: this._antialias});

    if (parameters.hasOwnProperty('pixelRatio')) {
      this._renderer.setPixelRatio(parameters.pixelRatio);
    }

    if (parameters.hasOwnProperty('clearColor')) {
      this._renderer.setClearColor(parameters.clearColor);
    }

    if (parameters.hasOwnProperty('shadowMapEnabled')) {
      this._renderer.shadowMap.enabled = parameters.shadowMapEnabled;
    }

    if (parameters.hasOwnProperty('shadowMapType')) {
      this._renderer.shadowMap.type = parameters.shadowMapType;
    }

    if (parameters.hasOwnProperty('shadowMapCullFace')) {
      this._renderer.shadowMap.cullFace = parameters.shadowMapCullFace;
    }

    if (parameters.hasOwnProperty('shadowMapDebug')) {
      this._renderer.shadowMap.debug = parameters.shadowMapDebug;
    }

    rendererProperties.forEach(propertyName => {
      if (parameters.hasOwnProperty(propertyName)) {
        this._renderer[propertyName] = parameters[propertyName];
      }
    });
    this._renderer.setSize(this._width, this._height);
  }

  initialize() {
    this.userData.events.on('animate', this._callOnAnimate);
  }

  getObjectsByName(objectName) {
    const objectsByName = this._objectsByName[objectName];

    let result;

    if (objectsByName) {
      const idToObjectMap = objectsByName.values;
      result = Object.keys(idToObjectMap)
        .map((name) => idToObjectMap[name]);
    } else {
      result = [];
    }

    return result;
  }

  addAnimateListener(callback) {
    this.userData.events.on('animate', callback);
  }

  removeAnimateListener(callback) {
    this.userData.events.removeListener('animate', callback);
  }

  addBeforeRenderListener(callback) {
    this.userData.events.on('preRender', callback);
  }

  removeBeforeRenderListener(callback) {
    this.userData.events.removeListener('preRender', callback);
  }

  _callOnAnimate = () => {
    if (this._onAnimate) {
      ReactUpdates.batchedUpdates(this._onAnimate);
    }
  };

  addChildren(children) {
    children.forEach(child => {
      if (child instanceof THREE.Scene) {
        this.setScene(child);
      } else if (child instanceof Viewport) {
        this.addViewport(child);
      } else if (child instanceof ResourceContainer) {
        this.addResourceContainer(child);
      } else {
        invariant(false, 'The react3 component should only contain viewports or scenes.');
      }

      if (this._mounted) {
        this.objectMounted(child);
      }
    });

    // const scenes = children.filter()
    // invariant(children.length === 1 && children[0] instanceof THREE.Scene, 'The react3 component should only have one scene as a child!');

    // threeObject.setScene(children[0]);
  }

  removeChild(child) {
    debugger;
  }

  _render = () => {
    this._renderRequest = requestAnimationFrame(this._render);
    this.userData.events.emit('animate');

    // the scene can be destroyed within the 'animate' event
    if (!this._scene || !this._mounted || !this._renderer) {
      return;
    }

    let mainCamera = null;

    if (this._mainCameraName) {
      const objectsWithMainCameraName = this._objectsByName[this._mainCameraName];

      if (objectsWithMainCameraName) {
        invariant(objectsWithMainCameraName.count < 2, 'There are multiple objects with name ' + this._mainCameraName);

        if (objectsWithMainCameraName.count > 0) {
          const values = objectsWithMainCameraName.values;
          mainCamera = values[Object.keys(values)[0]];
        }
      }
    }

    if (mainCamera) {
      if (this._lastRenderMode !== 'camera') {
        this._renderer.autoClear = true;
        this._renderer.setViewport(0, 0, this._width, this._height);
        this._lastRenderMode = 'camera';
      }
      CameraUtils.current = mainCamera;
      this.userData.events.emit('preRender');
      this._renderScene(mainCamera);
      CameraUtils.current = null;
    } else if (this._viewports.length > 0) {
      if (this._lastRenderMode !== 'viewport') {
        this._renderer.autoClear = false;
        this._lastRenderMode = 'viewport';
      }

      this._renderer.clear();
      this._viewports.forEach(viewport => {
        let viewportCamera = null;

        if (viewport.cameraName) {
          const objectsWithViewportCameraName = this._objectsByName[viewport.cameraName];

          if (objectsWithViewportCameraName) {
            invariant(objectsWithViewportCameraName.count < 2, 'There are multiple objects with name ' + viewport.cameraName);

            if (objectsWithViewportCameraName.count > 0) {
              const values = objectsWithViewportCameraName.values;
              viewportCamera = values[Object.keys(values)[0]];
            }
          }
        }

        if (!viewportCamera) {
          return;
        }

        if (viewport.onBeforeRender) {
          ReactUpdates.batchedUpdates(viewport.onBeforeRender);
        }

        this._renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
        CameraUtils.current = viewportCamera;
        this.userData.events.emit('preRender');
        this._renderScene(viewportCamera);
        CameraUtils.current = null;
      });
    }
  };

  _renderScene(camera) {
    this._renderer.render(this._scene, camera);
    if (this._highlightObjectId !== null) {
      const boundingBoxes = this._getHighlightBoundingBox();

      const highlightScene = this._highlightScene;

      const diff = highlightScene.children.length - boundingBoxes.length;

      if (diff > 0) {
        for (let i = 0; i < diff; i++) {
          highlightScene.remove(highlightScene.children[0]);
        }
      } else if (diff < 0) {
        for (let i = 0; i < -diff; i++) {
          highlightScene.add(new THREE.Mesh(this._highlightGeometry, this._highlightMaterial));
        }
      }

      boundingBoxes.forEach((boundingBox, i) => {
        const center = boundingBox.min.clone().add(boundingBox.max).multiplyScalar(0.5);

        const size = boundingBox.max.clone().sub(boundingBox.min);

        const highlightCube = highlightScene.children[i];

        highlightCube.position.copy(center);
        highlightCube.scale.copy(size);
      });

      const autoClear = this._renderer.autoClear;
      this._renderer.autoClear = false;
      this._renderer.render(highlightScene, camera);
      this._renderer.autoClear = autoClear;
    }
  }

  setScene(scene) {
    this._scene = scene;
  }

  addViewport(viewport) {
    this._viewports.push(viewport);
  }

  addResourceContainer(resourceContainer) {
    this._resourceContainers.push(resourceContainer);
  }

  updateWidth(newWidth) {
    this._width = newWidth;
    this._renderer.setSize(this._width, this._height);
  }

  _updateOnRecreateCanvas(threeObject, callback) {
    this._recreateCanvasCallback = callback;
  }

  updateHeight(newHeight) {
    this._height = newHeight;
    this._renderer.setSize(this._width, this._height);
  }

  updatePixelRatio(newPixelRatio) {
    this._parameters.pixelRatio = newPixelRatio;

    this._renderer.setPixelRatio(newPixelRatio);
    this._renderer.setSize(this._width, this._height);
  }

  updateShadowMapDebug(newShadowMapDebug) {
    this._parameters.shadowMapDebug = newShadowMapDebug;

    this._renderer.shadowMap.debug = newShadowMapDebug;
  }

  refreshRenderer() {
    this._materials.forEach(material => {
      material.dispose();// = true;
    });

    this._geometries.forEach(geometry => {
      geometry.dispose();// = true;
    });

    this._textures.forEach(texture => {
      texture.dispose();// = true;
    });

    this._renderer.dispose();

    const contextLossExtension = this._renderer.extensions.get('WEBGL_lose_context');

    delete this._renderer;

    if (contextLossExtension) {
      this._canvas.addEventListener('webglcontextlost', () => {
        // this should recreate the canvas
        this._recreateCanvasCallback();
      }, false);

      contextLossExtension.loseContext();
    } else {
      this._recreateCanvasCallback();
    }
  }

  updateAntiAlias(antialias) {
    this._parameters.antialias = antialias;

    this._antialias = antialias;
    this.refreshRenderer();
  }

  updateCanvas(canvas) {
    this._parameters.canvas = canvas;

    this._canvas = canvas;
    if (this.renderer) {
      this._materials.forEach(material => {
        material.dispose();// = true;
      });

      this._geometries.forEach(geometry => {
        geometry.dispose();// = true;
      });

      this._textures.forEach(texture => {
        texture.dispose();// = true;
      });

      this._renderer.dispose();

      const contextLossExtension = this._renderer.extensions.get('WEBGL_lose_context');
      if (contextLossExtension) {
        contextLossExtension.loseContext();
      }
    }

    this._createRenderer(this._parameters);
  }

  unmount() {
    this._mounted = false;
    cancelAnimationFrame(this._renderRequest);

    this.userData.events.removeListener('animate', this._callOnAnimate);
    this.userData.events.removeAllListeners();
    delete this._rendererInstance;

    const contextLossExtension = this._renderer.extensions.get('WEBGL_lose_context');

    if (contextLossExtension) {
      contextLossExtension.loseContext();
    }

    delete this._renderer;

    delete this._canvas;

    invariant(Object.keys(this._objectsByUUID).length === 0, 'Failed to cleanup some child objects for React3DInstance');

    delete this._objectsByUUID;
    delete this._viewports;
    delete this._scene;
    delete this._highlightScene;
    delete this._highlightObjectId;
    delete this._getHighlightBoundingBox;
  }

  objectMounted(object) {
    invariant(!this._objectsByUUID[object.uuid], 'There already is an object with this uuid in the react 3d instance.');

    this._objectsByUUID[object.uuid] = object;

    object.userData.markup._rootInstance = this;

    this._addObjectWithName(object.name, object);

    object.userData.events.on('highlight', this._objectHighlighted);

    object.userData.events.emit('addedIntoRoot', object);

    const current:THREE.Object3D = object;

    const childrenMarkup = current.userData.childrenMarkup;

    if (object instanceof THREE.Material) {
      this._materials.push(object);
    }

    if (object instanceof THREE.Geometry || object instanceof THREE.BufferGeometry) {
      this._geometries.push(object);
    }

    if (object instanceof THREE.Texture) {
      this._textures.push(object);
    }

    for (let i = 0; i < childrenMarkup.length; ++i) {
      const childMarkup = childrenMarkup[i];

      this.objectMounted(childMarkup.threeObject);
    }
  }

  _hideHighlight = () => {
    this._highlightObjectId = null;
    this._getHighlightBoundingBox = null;
  };

  _objectHighlighted = (info) => {
    const {uuid, boundingBoxFunc} = info;

    let obj;

    if (this._highlightObjectId) {
      obj = this._objectsByUUID[this._highlightObjectId];

      obj.userData.events.removeListener('hideHighlight', this._hideHighlight);
    }

    this._highlightObjectId = uuid;
    this._getHighlightBoundingBox = boundingBoxFunc;

    obj = this._objectsByUUID[uuid];

    obj.userData.events.once('hideHighlight', this._hideHighlight);
  };

  objectRenamed(object, oldName, nextName) {
    this._removeObjectWithName(oldName, object);
    this._addObjectWithName(nextName, object);
  }

  _addObjectWithName(objectName, object) {
    if (!this._objectsByName[objectName]) {
      this._objectsByName[objectName] = {
        count: 0,
        values: {},
      };
    }

    this._objectsByName[objectName].values[object.uuid] = object;
    this._objectsByName[objectName].count++;
  }

  _removeObjectWithName(objectName, object) {
    invariant(this._objectsByName[objectName] && this._objectsByName[objectName].values[object.uuid] === object, 'The object\'s name changed somehow?\'');

    delete this._objectsByName[objectName].values[object.uuid];
    this._objectsByName[objectName].count--;

    if (this._objectsByName[objectName].count === 0) {
      delete this._objectsByName[objectName];
    }
  }

  objectRemoved(object) {
    invariant(this._objectsByUUID[object.uuid] === object, 'The removed object does not belong here!?');

    if (this._highlightObjectId === object.uuid) {
      this._highlightObjectId = null;
    }

    object.userData.events.removeListener('highlight', this._objectHighlighted);
    object.userData.events.removeListener('hideHighlight', this._hideHighlight);

    delete this._objectsByUUID[object.uuid];

    if (object instanceof THREE.Material) {
      this._materials.splice(this._materials.indexOf(object), 1);
    }
    if (object instanceof THREE.Geometry || object instanceof THREE.BufferGeometry) {
      this._geometries.splice(this._geometries.indexOf(object), 1);
    }
    if (object instanceof THREE.Texture) {
      this._textures.splice(this._textures.indexOf(object), 1);
    }

    this._removeObjectWithName(object.name, object);
  }

  mountedIntoRoot() {
    this._mounted = true;
    this.objectMounted(this._scene);

    this._viewports.forEach(viewport => {
      this.objectMounted(viewport);
    });

    this._resourceContainers.forEach(resourceContainer => {
      this.objectMounted(resourceContainer);
    });
  }
}

export default React3DInstance;
