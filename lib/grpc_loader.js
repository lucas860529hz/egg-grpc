'use strict';

const path = require('path');
const grpc = require('grpc');
const traverse = require('traverse');
const extend = require('extend2');
const debug = require('debug')('grpc');
const protoLoader = require('@grpc/proto-loader');

module.exports = app => {
  const config = app.config.grpc;

  const defaults = {
    call: true,
    property: config.property,
    inject: app,
    fieldClass: 'grpcClasses',
    match: '**/*.proto',
    override: true,
    directory: app.loader.getLoadUnits().map(unit => path.join(unit.path, config.dir)),
    initializer(content, meta) {
      // Lucas: where load proto
      const packageDefinition = protoLoader.loadSync(meta.path, Object.assign({}, config.loadOpts));
      debug('loading proto: %s', meta.path);
      // load will change opts, so need to clone
      return grpc.loadPackageDefinition(packageDefinition);
    },
  };

  class GrpcLoader extends app.loader.ContextLoader {
    constructor(options) {
      options = Object.assign({}, defaults, options);
      super(options);
    }

    parse() {
      const newItems = [];
      const items = super.parse();

      for (const item of items) {
        const { exports, fullpath } = item;

        // save origin proto to `app.grpcProto`
        extend(true, app.grpcProto, exports);

        // TODO: whether change case of Service/Message

        // traverse origin grpc proto to extract rpc service
        // `/example.Test/Echo` -> `app.grpcClasses.example.test` -> `yield ctx.grpc.example.test.echo()`
        traverse(exports).forEach(function(proto) {
          /* istanbul ignore next */
          if (this.circular) this.remove();

          if (proto) {
            if (proto.name === 'Client' || proto.name === 'ServiceClient') {
              const properties = this.path.map(camelize);
              proto.paths = properties;
              const item = {
                fullpath,
                properties,
                exports: wrapClass(proto),
              };
              newItems.push(item);
              this.update(proto, true);
              // Lucas: register service
              debug('register grpc service: %s', properties.join('.'));
            } else if (proto.type && proto.type.name) {
              // TODO there is no proto named "Message" in new structure of proto loader
              this.update(proto, true);
            }
          }
        });
      }
      // [{ fullpath, properties, exports }]
      return newItems;
    }
  }

  function wrapClass(...args) {
    return class GrpcSubClass extends app.GrpcClass {
      constructor(ctx) {
        super(ctx, ...args);
      }
    };
  }

  function camelize(input) {
    input = input.replace(/[_-][a-z]/ig, s => s.substring(1).toUpperCase());
    return input[0].toLowerCase() + input.substring(1);
  }

  return GrpcLoader;
};
