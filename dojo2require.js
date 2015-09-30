var vm = require('vm');
var fs = require('fs');

var file = fs.readFileSync('dgrid.js', 'utf-8');

var sandbox = {
    require: function (obj){
        var cache = obj.cache;
        for (var path in cache){
            var func = cache[path]
                .toString()
                .replace('define([', 'define("' + path + '", [');
            if (1){
                
                fs.appendFileSync('out.js', func.substring(func.indexOf('{') + 1, func.lastIndexOf('}') ))
            }

        }


    }
};

vm.createContext(sandbox);
vm.runInContext(file, sandbox);
