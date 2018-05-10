module.exports = {
  'extends': 'google',
  'parserOptions': {
    'ecmaVersion': 2017,
    'sourceType': 'module',
  },
  'env': {
    'node': true,
  },
  'rules': {
    'max-len': ['error', 200, 2, {ignoreComments: true}],
  },
};