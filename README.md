## Convert Your MD Posts to Hugo

TLDL.

run `npm run convert --source=<your posts dir> [--custom-highlight=1]`

## configure file


`config.json`

```
{
  "blackList": [        // ignore list
    ".DS_Store",
    ".git",
    ".gitignore",
    "README.json",
    "README.md"
  ],
  "charset": "utf-8",   // output file charset
  "debug": {
    "enable": true,
    "maxFilesCount": 3  // covert file limit
  }
}
```

## 使用方法

```
./bin/convert --source=../My-Blog-Posts --custom-highlight=1 --dist=../blog-2017/content
```