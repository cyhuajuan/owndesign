我要基于现有页面创建一个副本并修改。
请先使用 `copyFile` 把 {{sourcePath}} 复制到 {{targetPath}}，然后只修改 {{targetPath}}。
可以检查其他文件；只有在共享组件、共享导航或导航链接维护规则明确需要时，才协调更新相关文件。
如果 {{targetPath}} 是某个页面 slug 的新版本，请在需要时让共享导航链接指向最新版本。

源页面：{{sourcePath}}
目标页面：{{targetPath}}
当前预览页面：{{currentPreviewPath}}

具体要求：
{{originalUserPrompt}}
