var _ = require('underscore')
var widgets = require('@jupyter-widgets/base');
var THREE = require('three')
var serialize = require('./serialize.js')
var semver_range = require('./utils.js').semver_range;

var shaders = {}

shaders["box_fragment"] = require('raw-loader!../glsl/box-fragment.glsl');
shaders["box_vertex"] = require('raw-loader!../glsl/box-vertex.glsl');

var VolumeView = widgets.WidgetView.extend( {
    render: function() {
        this.renderer = this.options.parent;
        this.attributes_changed = {}
        this.volume_data = []

        window.last_volume_view = this;

        var render_size = this.renderer.getRenderSize()

        this.vol_box_geo = new THREE.BoxBufferGeometry(1, 1, 1);
        //this.box_material = new THREE.MeshLambertMaterial({color: 0xCC0000});
        this.box_material = new THREE.ShaderMaterial({
            uniforms: {
                offset: { type: '3f', value: [0, 0, 0] },
                scale : { type: '3f', value: [1, 1, 1] },
            },
            fragmentShader: shaders["box_fragment"],
            vertexShader: shaders["box_vertex"],
            side: THREE.BackSide
        });
        this.vol_box_mesh = new THREE.Mesh(this.vol_box_geo, this.box_material)
        //this.vol_box_mesh.position.z = -5;
        this.vol_box_mesh.updateMatrix()
        this.vol_box_mesh.matrixAutoUpdate = true

        this.texture_loader = new THREE.TextureLoader()

        this.texture_tf = null;//new THREE.DataTexture(null, this.model.get("tf").get("rgba").length, 1, THREE.RGBAFormat, THREE.UnsignedByteType)

        this.uniform_volumes_values = {}
        this.uniform_volume_data = {type: 'tv', value: []}
        this.uniform_volume_transfer_function = {type: 'tv', value: []}


        // var update_volr_defines = () => {
        //     if(this.model.get('volume_rendering_method') )
        //     this.box_material_volr.defines = {USE_LIGHTING: this.model.get('volume_rendering_lighting')}
        //     //this.box_material_volr.defines['METHOD_' + this.model.get('volume_rendering_method')] = true;
        //     //this.box_material_volr.defines['VOLUME_COUNT'] = 1
        //     this.box_material_volr.needsUpdate = true
        //     this.box_material_volr_depth.defines = {COORDINATE: true, USE_LIGHTING: this.model.get('volume_rendering_lighting')}
        //     //this.box_material_volr_depth.defines['METHOD_' + this.model.get('volume_rendering_method')] = true;
        //     this.box_material_volr_depth.needsUpdate = true;
        //     //this.box_material_volr_depth.defines['VOLUME_COUNT'] = 1
        // }

        this.tf_set()
        this.data_set()
        var update_rendering_method = () => {
            this.renderer.rebuild_multivolume_rendering_material()
            this.renderer.update()
        }
        this.model.on('change:volume_rendering_method', update_rendering_method)
        //this.model.on('change:volume_rendering_method change:volume_rendering_lighting', update_volr_defines)
        update_rendering_method()


        this.add_to_scene()

        this.model.on('change:volume_data', this.data_set, this);

        var update_volume_minmax = () => {
            this.uniform_volumes_values.volume_data_range = [this.model.get('volume_data_min'), this.model.get('volume_data_max')]
            this.uniform_volumes_values.volume_show_range = [this.model.get('volume_show_min'), this.model.get('volume_show_max')]
    
        }
        this.model.on('change:volume_data_min change:volume_data_max change:volume_show_min change:volume_show_max', update_volume_minmax, this);
        update_volume_minmax()

        var update_volume_clamp = () => {
            this.uniform_volumes_values.clamp_min = this.model.get('volume_clamp_min')
            this.uniform_volumes_values.clamp_max = this.model.get('volume_clamp_max')
    
        }
        this.model.on('change:volume_clamp_min change:volume_clamp_max', update_volume_clamp, this);
        update_volume_clamp()

        var update_opacity_scale = () => {
            this.uniform_volumes_values.opacity_scale = this.model.get('opacity_scale')
    
        }
        update_opacity_scale()
        this.model.on('change:opacity_scale', update_opacity_scale)

        this.model.on('change:tf', this.tf_set, this)        

        window.last_volume = this; // for debugging purposes

    },
    is_max_intensity() {
        return this.model.get('volume_rendering_method') == 'MAX_INTENSITY';
    },
    is_normal() {
        return this.model.get('volume_rendering_method') == 'NORMAL';
    },
    data_set: function() {
        this.volume = this.model.get("volume_data")
        var data = new Uint8Array(this.volume.tiles.buffer)
        this.texture_volume = new THREE.DataTexture(data, this.volume.image_shape[0], this.volume.image_shape[1],
                                                    THREE.RGBAFormat, THREE.UnsignedByteType)
        this.texture_volume.magFilter = THREE.LinearFilter
        this.texture_volume.minFilter = THREE.LinearFilter
        this.uniform_volumes_values.volume_rows = this.volume.rows
        this.uniform_volumes_values.volume_columns = this.volume.columns
        this.uniform_volumes_values.volume_slices = this.volume.slices
        this.uniform_volumes_values.volume_size = this.volume.image_shape
        this.uniform_volumes_values.volume_slice_size = this.volume.slice_shape
        this.uniform_volume_data.value = [this.texture_volume]
        this.uniform_volume_data.value = [this.texture_volume]
        this.uniform_volumes_values.volume_data_range = [this.model.get('volume_data_min'), this.model.get('volume_data_max')]
        this.uniform_volumes_values.volume_show_range = [this.model.get('volume_show_min'), this.model.get('volume_show_max')]
        this.texture_volume.needsUpdate = true // without this it doesn't seem to work
    },
    tf_set: function() {
        // TODO: remove listeners from previous
        if(this.model.get("tf")) {
            this.model.get("tf").on('change:rgba', this.tf_changed, this);
            this.tf_changed()
        }
    },
    tf_changed: function() {
        var tf = this.model.get("tf")
        if(tf) {
            /*if(!this.texture_tf) {
                this.texture_tf = new THREE.DataTexture(tf.get_data_array(), tf.get("rgba").length, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
            } else {
                this.texture_tf.image.data = tf.get_data_array()
                this.texture_tf.needsUpdate = true
            }*/
            this.texture_tf = new THREE.DataTexture(tf.get_data_array(), tf.get("rgba").shape[0], 1, THREE.RGBAFormat, THREE.UnsignedByteType)
            this.texture_tf.needsUpdate = true // without this it doesn't seem to work
            // this.box_material_volr.uniforms.volume_transfer_function.value = [this.texture_tf]
            this.uniform_volume_transfer_function.value = [this.texture_tf]
        }
        this.renderer.rebuild_multivolume_rendering_material()
        this.renderer.update()
    },
    set_limits: function(limits) {
        var xlim = limits.xlim;
        var ylim = limits.ylim
        var zlim = limits.zlim
        var dx = (xlim[1] - xlim[0])
        var dy = (ylim[1] - ylim[0])
        var dz = (zlim[1] - zlim[0])

        var dmax = Math.max(dx,dy,dz); 

        var extent = this.model.get('extent')

       // normalized coordinates of the corners of the box 
        var x0n = (extent[0][0]-xlim[0])/dmax
        var x1n = (extent[0][1]-xlim[0])/dmax
        var y0n = (extent[1][0]-ylim[0])/dmax
        var y1n = (extent[1][1]-ylim[0])/dmax
        var z0n = (extent[2][0]-zlim[0])/dmax
        var z1n = (extent[2][1]-zlim[0])/dmax

        // clipped coordinates
        var cx0 = Math.max(x0n,  0)
        var cx1 = Math.min(x1n,  1)
        var cy0 = Math.max(y0n,  0)
        var cy1 = Math.min(y1n,  1)
        var cz0 = Math.max(z0n,  0)
        var cz1 = Math.min(z1n,  1)

        // the clipped coordinates back to world space, then normalized to extend
        // these are example calculations, the transform goes into scale and offset uniforms below
        // var cwx0 = (cx0 * dx + xlim[0] - extent[0][0])/(extent[0][1] - extent[0][0])
        // var cwx1 = (cx1 * dx + xlim[0] - extent[0][0])/(extent[0][1] - extent[0][0])

        // this.box_geo = new THREE.BoxBufferGeometry(cx1-cx0, cy1-cy0, cz1-cz0)
        // this.box_geo.translate((cx1-x0)/2, (cy1-cy0)/2, (cz1-cz0)/2)
        // this.box_geo.translate(cx0, cy0, cz0)
        // this.box_geo.translate(-0.5, -0.5, -0.5)
        this.box_geo = new THREE.BoxBufferGeometry(1, 1, 1)
        this.box_geo.translate(0.5, 0.5, 0.5)
        this.box_geo.scale((cx1-cx0), (cy1-cy0), (cz1-cz0))
        this.box_geo.translate(cx0, cy0, cz0)
        this.box_geo.translate(-0.5, -0.5, -0.5)
        this.vol_box_mesh.geometry = this.box_geo
        
        this.uniform_volumes_values.scale = [1/(x1n-x0n), 1/(y1n-y0n), 1/(z1n-z0n)]
        this.uniform_volumes_values.offset = [-x0n, -y0n, -z0n]
    },
    add_to_scene: function() {
        this.renderer.scene_volume.add(this.vol_box_mesh)
    },
    remove_from_scene: function() {
        this.renderer.scene_volume.remove(this.vol_box_mesh)
    },
});

var VolumeModel = widgets.WidgetModel.extend({
    defaults: function() {
        return _.extend(widgets.WidgetModel.prototype.defaults(), {
            _model_name : 'VolumeModel',
            _view_name : 'VolumeView',
            _model_module : 'ipyvolume',
            _view_module : 'ipyvolume',
            _model_module_version: semver_range,
             _view_module_version: semver_range,
            sequence_index: 0,
            step_size: 0.01,
            ambient_coefficient: 0.5,
            diffuse_coefficient: 0.8,
            specular_coefficient: 0.5,
            specular_exponent: 5,
            opacity_scale: 1.0,
            extent: null,
            volume_rendering_lighting: true,
            volume_rendering_method: 'NORMAL',
            volume_clamp_min: false,
            volume_clamp_max: false,
            volume_data_range: null,
            volume_show_range: null,
        })
    }}, {
    serializers: _.extend({
        tf: { deserialize: widgets.unpack_models }
    }, widgets.DOMWidgetModel.serializers)
});



module.exports = {
    VolumeView:VolumeView,
    VolumeModel:VolumeModel
}
