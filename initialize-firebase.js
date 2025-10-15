async function dynamicImport(specifier) {
  const loader = new Function(
    'specifier',
    'return import(specifier);'
  );
  return loader(`firebase/${specifier}`);
}

function createNoopSetDoc() {
  return async (_ref, _data) => {
    console.warn('Firebase SDK not available. Skipping Firestore document write.');
  };
}

async function initializeFirebase() {
  const firebaseConfigA = {
    apiKey: "AIzaSyAeqLc3arKfR4Sl3WEFbAhbLZD5Kmk3ehY",
    authDomain: "northwell-looker-app.firebaseapp.com",
    projectId: "northwell-looker-app",
    storageBucket: "northwell-looker-app.appspot.com",
    messagingSenderId: "468277386481",
    appId: "1:468277386481:web:b1cd244f1cc203c392dd50",
    measurementId: "G-3MZXSBKEPY"
  };

  try {
    const { initializeApp } = await dynamicImport('app');
    const { getFirestore, doc, setDoc } = await dynamicImport('firestore');

    const app1 = initializeApp(firebaseConfigA, "app1");
    const db1 = getFirestore(app1);

    const sourceRef = doc(db1, "configs", "def");

    // return an object, not individual exports
    return { setDoc, sourceRef };
  } catch (error) {
    console.warn('Falling back to no-op Firestore writer because the Firebase SDK could not be loaded.', error);
    return {
      setDoc: createNoopSetDoc(),
      sourceRef: "configs/def"
    };
  }
}

module.exports = { initializeFirebase };
