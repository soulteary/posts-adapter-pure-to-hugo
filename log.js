'use strict';

// @see https://github.com/Marak/colors.js/blob/master/lib/styles.js
let styles = {};
const codes = {
  reset: [0, 0],

  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  inverse: [7, 27],
  hidden: [8, 28],
  strikethrough: [9, 29],

  black: [30, 39],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  white: [37, 39],
  gray: [90, 39],
  grey: [90, 39],

  bgBlack: [40, 49],
  bgRed: [41, 49],
  bgGreen: [42, 49],
  bgYellow: [43, 49],
  bgBlue: [44, 49],
  bgMagenta: [45, 49],
  bgCyan: [46, 49],
  bgWhite: [47, 49]
};

Object.keys(codes).forEach(function(key) {
  var val = codes[key];
  var style = styles[key] = [];
  style.open = '\u001b[' + val[0] + 'm';
  style.close = '\u001b[' + val[1] + 'm';
});

function echo() {
  let argvs = Array.prototype.slice.call(arguments);
  let style = {
    label: null,
    text: null
  };
  let fn = console.log;

  switch (argvs[0]) {
    case 'log':
      style.label = styles.cyan;
      style.text = styles.grey;
      break;
    case 'info':
      style.label = styles.blue;
      style.text = styles.white;
      break;
    case 'warn':
      style.label = styles.yellow;
      style.text = styles.white;
      break;
    case 'error':
      style.label = styles.red;
      style.text = styles.red;
      fn = console.error;
      break;
    default:
      style.label = styles.white;
      style.text = styles.grey;
      break;
  }

  argvs.shift();
  argvs[0] = style.label.open + argvs[0] + style.label.close;
  for (var i = 1, j = argvs.length; i < j; i++) {
    argvs[i] = style.text.open + argvs[i] + style.text.close;
  }

  return fn.apply(console, argvs);
}

module.exports = function(moduleName) {
  return {
    log: echo.bind(null, 'log', moduleName),
    info: echo.bind(null, 'info', moduleName),
    warn: echo.bind(null, 'warn', moduleName),
    error: echo.bind(null, 'error', moduleName)
  };
};
