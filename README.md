# BookBites

BookBites is a React app that turns PDF books into bite-sized AI-generated insight cards. It uses Claude AI to detect chapters and generate cards, and Google Sheets as an optional cache so a book only needs to be processed once.

---

## Google Sheets Setup (required for caching)

The `google-apps-script/Code.gs` file in this repository is a Google Apps Script web app that acts as the backend for the Google Sheets cache.

### Steps

1. **Create a Google Sheet.**

2. **Open the Apps Script editor.**  
   Inside the sheet go to **Extensions → Apps Script**.

3. **Paste the script.**  
   Replace any existing code in `Code.gs` with the contents of `google-apps-script/Code.gs` from this repo.

4. **Deploy as a Web App.**
   - Click **Deploy → New deployment**.
   - Type: **Web App**.
   - Execute as: **Me**.
   - Who has access: **Anyone**.
   - Click **Deploy** and copy the URL (looks like `https://script.google.com/macros/s/…/exec`).

5. **Set the environment variable.**  
   Add `REACT_APP_SHEETS_URL=<your-deployment-url>` to your Vercel project (or `.env.local` for local dev) and redeploy.

### How the script works

| Request | What it does |
|---------|-------------|
| `GET ?bookTitle=…&pdfFilename=…` | Returns `{ cards: […] }` if a matching row exists (matches by **bookTitle OR pdfFilename**, case-insensitive). Returns `{ cards: [] }` when nothing is found. |
| `POST { bookTitle, pdfFilename, cards }` | Saves a new row, or updates an existing match. |

The sheet is created automatically with columns: `bookTitle`, `pdfFilename`, `cards` (JSON), `savedAt`.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REACT_APP_ANTHROPIC_KEY` | Yes | Anthropic API key for Claude |
| `REACT_APP_SHEETS_URL` | Optional | Google Apps Script web app URL (enables caching) |

---

## Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
