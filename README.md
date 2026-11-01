# Gesture Lab — Hand Gesture Tracker

A browser based hand gesture tracker built with MediaPipe, TensorFlow Lite, Firebase, and Vercel. The app detects a hand, classifies static hand signs, and recognizes index fingertip movement in real time.

**Live demo:** https://hand-gesture-tracker-phi.vercel.app<br>
**Learning guide:** https://hand-gesture-learning-guide.vercel.app

## What it does

- Uses the browser camera with an explicit user click and permission prompt.
- Finds 21 hand landmarks with MediaPipe Tasks Vision.
- Runs the included hand sign and fingertip history TFLite classifiers in the browser.
- Recognizes Open, Close, Pointer, and OK hand signs, plus Stop, Clockwise, Counter Clockwise, and Move fingertip patterns.
- Draws the hand skeleton and displays handedness and model confidence.
- Keeps camera frames and landmarks on the device. Optional session summaries contain only duration and gesture counts.
- Saves those summaries to per-user Cloud Firestore paths using Firebase anonymous authentication and restrictive Firestore rules.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

```bash
npm ci
cp .env.example .env.local
```

Fill `.env.local` with the Firebase Web App values for your Firebase project:

```ini
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

Then start the dev server:

```bash
npm run dev
```

Open the local HTTPS address shown by Vite (or `http://localhost`, which browsers treat as a secure context), allow camera access, and start tracking. If Firebase values are missing, recognition still works, but Firebase session saving is disabled.

## Firebase setup

1. Create a Firebase project and register a Web App.
2. Enable **Authentication → Sign-in method → Anonymous**.
3. Create a Cloud Firestore database in a region appropriate for your users.
4. Deploy the checked-in security rules:

   ```bash
   firebase use YOUR_FIREBASE_PROJECT_ID
   firebase deploy --only firestore:rules
   ```

5. Add the Web App config values as Vercel Production and Preview environment variables (or place them in `.env.local` for local development).

The rules restrict each authenticated anonymous user to their own `/users/{uid}/sessions` documents. The app never uploads camera frames, landmark arrays, or a name/email. Firebase Web configuration identifies the project and is intended for client use; Firestore Security Rules enforce access. Anonymous identities stay associated with that browser's Firebase Auth storage and are not recoverable if browser storage is cleared.

## Deploy to Vercel

Import the GitHub repository into Vercel, set the four `VITE_FIREBASE_*` environment variables, and deploy. Vercel runs `npm ci` followed by `npm run build` and serves the `dist` directory. Camera access requires HTTPS in production.

## How inference works

1. MediaPipe Hand Landmarker returns 21 normalized landmarks per detected hand.
2. The 21 x/y points are converted to pixel coordinates, shifted relative to the wrist, flattened, and scaled by their maximum absolute coordinate. The resulting 42 values match the original static classifier input.
3. The original keypoint TFLite model predicts a hand sign.
4. For the Pointer class, the index fingertip coordinate is added to a 16-frame history. Coordinates are made relative to the first point and normalized by image width and height, matching the original motion-model feature layout.
5. The point-history TFLite model predicts fingertip movement; the UI smooths momentary changes across recent predictions.

The computer vision model in MediaPipe is pre-trained. The two small TFLite classifiers shipped in the original repository are separate models trained from landmark features. This project runs those existing models in the browser; it does not train or fine-tune MediaPipe.

## Project structure

```text
src/main.js                         Camera flow, landmark features, inference, UI state
src/style.css                       Responsive dark interface
src/firebase.js                     Firebase initialization and optional session writes
model/*/*.tflite                    Original trained landmark classifiers
model/*/*_label.csv                 Class names for the original models
model/*/*.csv                       Original training examples
*.ipynb                             Original model-training notebooks
app.py                              Original Python/OpenCV desktop implementation
firestore.rules                     Per-user session access policy
firebase.json                       Firebase CLI rules config
vercel.json                         Vercel build and response headers
```

## Attribution and license

The Python demo, notebooks, CSV training data, and TFLite models originate from [Kazuhito00/hand-gesture-recognition-using-mediapipe](https://github.com/Kazuhito00/hand-gesture-recognition-using-mediapipe), English translation by [kinivi/hand-gesture-recognition-mediapipe](https://github.com/kinivi/hand-gesture-recognition-mediapipe). They are distributed under the included Apache 2.0 license. This repository adds a browser interface, integration code, Firebase rules, and deployment setup. Credit the original authors when presenting or extending the model and dataset.
