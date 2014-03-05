var fs = require('fs');
var mongoose = require('mongoose');
var gfs = null, Grid = require('gridfs-stream');
var cloudinary = require('cloudinary');
var meta = require('./meta');
var utils = require('./utils');
var use_gfs = false;

Grid.mongo = mongoose.mongo;

exports.init = function (config, resource_class_name, user_class_name) {
  gfs = new Grid(mongoose.connection.db, mongoose.mongo);
  console.log('current13 0.0.0');
  meta.init(config, resource_class_name, user_class_name);
}

exports.meta = meta;
exports.utils = utils;



/* put the meta info in every request */

exports.add_meta = function (req, res, next) {
  req.models = res.locals.models = meta.meta();
  var type = req.params.type;
  if (type)
  {
    req.type = type;
    req.schema = meta.schema(type);
    req.model = meta.model(type);
    req.browser = meta.browse(type);
    req.form = meta.form(type);
  }
  next();
};

/* find and populate a "deep" view of the model as well as all "related" entities */
exports.add_object = function (req, res, next) {
  if (!req.params.id)
  {
    next();
    return;
  }
  expand(req.type, req.params.id, function (err, m) {
    if (err) {
      next(err);
      return;
    }
    req.object = m;
    if (m)
      related(req.type, m._id, function(r){
        req.related = r;
        req.related_count = r._count;
        delete r._count;
        next();
      });
    else
      next();
  });
};

expand = function(type, id, next)
{
  var q = meta.model(type).findOne({_id: id});
  q.exec(function (err, m) {
    populate_deep(type, m, function(){
        next(err, m);
    });
  });
};

populate_deep = function(type, instance, next, seen)
{
  if (type == 'User' || !instance)
  {
    next();
    return;
  }
  if (!seen)
    seen = {};
  if (seen[instance._id])
  {
    next();
    return;
  }
  seen[instance._id] = true;
  var refs = meta.get_references(meta.schema(type));
  if (!refs)
  {
    next();
    return;
  }
  var opts = [];
  for (var i=0; i<refs.length; i++)
    opts.push({path: refs[i].name, model: refs[i].ref});
  meta.model(type).populate(instance, opts, function(err,o){
    utils.process_list(refs, function (r, n) {
      if (r.is_array)
        utils.process_list(o[r.name], function (v, nn) {
          populate_deep(r.ref, v, nn, seen);
        }, n);
      else
        populate_deep(r.ref, o[r.name], n, seen);
    }, next);
  });
}


related = function (type, id, next) {
  var related_refs = [];
  for (var p in meta.meta()) {
    var refs = meta.get_references(meta.schema(p));
    for (var i = 0; i < refs.length; i++) {
      if (refs[i].ref == type) {
        related_refs.push({type: p, field: refs[i]});
      }
    }
  }
  var related_records = { _count: 0 };
  if (related_refs) {
    utils.process_list(related_refs, function (ref, n) {
      var c = {};
      c[ref.field.name] = {$in: [id]}
      var q = meta.model(ref.type).find(c);
      q.exec(function (err, qr) {
        related_records._count += qr.length;
        related_records[ref.type] = {field: ref.field, results: qr, query: q};
        n();
      });
    }, function () {
      next(related_records);
    });
  }
  else
    next(related_records);
};

// queries? piping results?
//      if (req.queries)
//      {
//        var keys = Object.keys(req.queries);
//        req.related = {};
//        utils.process_list(keys, function (e, n) {
//          var q = m[e](piped);
//          q.exec(function (err, r) {
//            req.related[e] = r;
//            n();
//          });
//        }, next);
//      }
//      else
//        next();






// the 'views'

exports.show_dashboard = function (req, res, next) {
  res.render('cms/dashboard', {
    title: 'CMS Dashboard ',
    models: req.models
  });
};


exports.browse = {
  get: function (req, res, next) {
    var conditions = req.body.condition;
    req.model.count(conditions, function (err, count) {
      if (err){
        next(err);
        return;
      }
      res.render('cms/browse', {
        title: 'CMS Dashboard ',
        browser: req.browser,
        type: req.type,
        total: count
      });
    });
  },
  post: function (req, res, next) {
    var conditions = req.body.condition;
    var fields = null;
    var options = {sort: req.body.order, skip: req.body.offset, limit: req.body.limit};
    req.model.count(conditions, function (err, count) {
      if (err){
        next(err);
        return;
      }
      var q = req.model.find(conditions, fields, options);
      var refs = meta.get_references(req.schema);
      if (refs)
        q.populate(meta.get_names(refs).join(" "));
      q.exec(function (err, r) {
        if (err)
          next(err);
        else
          res.json({results: r, count: count});
      });
    });
  }
};


exports.schema = function (req, res, next) {
  res.json({schema: meta.get_schema_info(req.schema), browser: req.browser});
};


exports.form =
{
  get: function (req, res) {
    res.render('cms/form', {
      title: (req.object ? 'Editing' : 'Creating') + ' ' + req.type,
      ancestors: [{url:'/cms/browse/'+req.type, name:req.type}],
      type: req.type,
      id: req.id ? req.id : null,
      form: req.form});
  },

  get_json: function(req,res) {
    var related = {};
    for (var p in req.related)
    {
      related[p] = req.related[p].results;
    }
    res.json({
      title: (req.object ? 'Editing' : 'Creating') + ' ' + req.type,
      type: req.type,
      object: req.object || new req.model(),
      related: related,
      form: req.form})
  },

  post: function (req, res, next) {
    var s = req.object || new req.model();
    var data = JSON.parse(req.body.val);
    for (var p in data) {
      s[p] = data[p];
    }
    if (!s.creator)
      s.creator = req.session.user._id;
    //emit('presave',s)
    s.save(function (err, s) {
      if (err)
        res.json(err);
      else {
        expand(req.type, req.params.id, function (err, m) {
          if (err)
            next(err);
          else
            res.json(m ? m : s);
        });
      }
    });
  },

  delete_references: function(req, res, next) {
    if (req.related_count == 0)
      res.json({});
    else
    {
      var to_update = [];
      for (var p in req.related)
      {
        if (req.related[p].results.length == 0)
          continue;
        var f = req.related[p].field;
        var o = {};
        o[f.name] = req.object._id;
        to_update.push({o: o, p: p});
      }
      var info = [];
      utils.process_list(to_update,function(e,n){
          meta.model(e.p).update(e.o, {$pull: e.o}, { multi: true }, function(err,x){
            info.push('Removed '+x+' reference(s) from '+ e.p+".");
            n();
        });
      }, function(){
        res.json(info)
      })
    }
  },

  delete: function(req, res, next) {
     req.object.remove(function(err,m){
       res.json(m);
     });
  }
};


// image and resource handling


exports.get_preview_url = function(e)
{
  return cloudinary.url(e.public_id + ".jpg", { width: 300, height: 200 , crop: 'fit'});
};


exports.upload = function (req, res) {
  var file = req.files.file;
  var do_save = function (e) {
    // create a resource with path & return id
    var r = new meta.Resource();
    r.path = file.name;
    r.size = file.size;
    r.creator = req.session.user._id;
    r.meta = e;
    if (e)
      r.meta.thumb = exports.get_preview_url(e);
    r.save(function (err, s) {
      res.json(s);
    });
  };
  if (use_gfs) {
    save_gfs(file, do_save);
  }
  else {
    var imageStream = fs.createReadStream(file.path, { encoding: 'binary' });
    var cloudStream = cloudinary.uploader.upload_stream(function (e) {
      do_save(e);
    });
    imageStream.on('data', cloudStream.write).on('end', cloudStream.end);
  }

};


exports.delete_resource = function (req, res) {
  var q = meta.Resource.findOne({_id: req.params.id});
  q.exec(function (err, r) {
    if (r) {
      cloudinary.uploader.destroy(r.meta.public_id, function (result) {
        res.json(result);
      });
    }
    else {
      res.send('ERR');
    }
  });
}


// for gfs
exports.download = function (req, res) {
  // TODO: set proper mime type + filename, handle errors, etc...
  var q = Resource.findOne({_id: req.params.id});
  q.exec(function (err, r) {
    if (r) {
      gfs
        .createReadStream({ filename: "/thumb" + r.path })
        .pipe(res);
    }
    else {
      res.send('ERR');
    }
  });
};


function save_gfs(file, next)
{
    var ws = gfs.createWriteStream({ filename: file.path });
    ws.on('error', function (e) {
      next(e);
    });
    var rs = fs.createReadStream(file.path);
    rs.on('open', function () {
      rs.pipe(ws);
    });
    rs.on('end', function () {
      next(null);
    });
    rs.on('error', function (e) {
      next(e);
    });

}


