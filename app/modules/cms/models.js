var mongoose = require('mongoose');

var ResourceSchemaInfo = {
  title: String,
  caption: String,
  description: String,
  path: String,
  size: Number,
  mime_type: String,
  meta: mongoose.Schema.Types.Mixed
};

exports.models = {

  Resource: {
    meta: {
      plural: 'Resources'
    },
    schema: ResourceSchemaInfo,
    browse: [
      {name: "title", cell: "char", filters: ["icontains", "equals"], order: "asc,desc,default"},
      {name: "path", cell: "char", filters: ["icontains", "equals"], order: "asc,desc"},
      {name: "meta", cell: "image"},
    ],
    form: [
      {name: "title", widget: "input"},
      {name: "caption", widget: "input"},
      {name: "description", widget: "rich_text"},
    ]
  }

}


// log
var LogSchema = new mongoose.Schema({
  user: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
  action: String,
  type: String,
  id: mongoose.Schema.Types.ObjectId,
  info: mongoose.Schema.Types.Mixed,
  time: { type: Date, default: Date.now }
})
exports.Log = mongoose.model('Log', LogSchema);

// group
// transition
// assignment
// msg
