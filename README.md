# Sudoku Lens

纯前端数独拍照求解网页。用户可以拍照或上传数独图片，浏览器端会尝试识别 9x9 数字，并把结果放进可手动校正的棋盘，校正后可一键求解。

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev -- --port 5173
```

如果你从其他目录启动，可以运行：

```powershell
powershell -ExecutionPolicy Bypass -File F:\codex\sudu\start-dev.ps1
```

也可以在项目目录里运行固定端口脚本：

```powershell
npm.cmd run dev:local
```

打开 `http://localhost:5173`。

## 验证

```powershell
npm.cmd test
npm.cmd run build
```

## 分享给朋友

这个项目是纯前端静态网页，构建后可以部署到 GitHub Pages、Cloudflare Pages、Netlify 或任何静态文件服务器。朋友只需要打开 HTTPS 链接即可在 iPhone、Android、Windows、macOS、Linux 浏览器中使用。

### GitHub Pages 自动部署

1. 在 GitHub 新建仓库，例如 `sudoku-lens`。
2. 把本项目 push 到仓库的 `main` 分支。
3. 进入仓库 `Settings -> Pages`。
4. 在 `Build and deployment` 里选择 `Source: GitHub Actions`。
5. 等待 Actions 跑完后，访问 Pages 给出的链接。

本项目已经包含 `.github/workflows/deploy.yml`，每次 push 到 `main` 都会自动构建并发布。

## 说明

- 完全在浏览器运行，不依赖后端或云 OCR。
- OCR 使用 `@paddleocr/paddleocr-js` / PP-OCRv5，在浏览器端本地运行；具体模型为文本检测 `PP-OCRv5_mobile_det` 和文本识别 `PP-OCRv5_mobile_rec`，并结合整板识别、网格线擦除、坐标回填和逐格补识别。
- PaddleOCR.js 依赖的 ONNX Runtime Web 资源托管在 `public/ort/`，首次识别需要加载模型和 WASM 资源，可能比后续识别慢一些。
- OCR 仍可能受照片倾斜、阴影、字体和边框影响，求解前建议核对棋盘数字。
