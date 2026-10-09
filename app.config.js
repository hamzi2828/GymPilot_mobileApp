// app.json, plus the one setting that depends on a file only the owner can
// get: Firebase's google-services.json, which Android needs before it will
// hand the app a push token.
//
// Naming the file in app.json outright would stop every Android build until
// it exists ("Cannot copy google-services.json"). So it is named here only
// when it is there: without it the app builds and runs, and simply cannot
// receive push on Android (Profile says so); with it, nothing else needs
// editing. On EAS the file can come from a file secret named
// GOOGLE_SERVICES_JSON instead of being committed -- see the README.

/* global __dirname */
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || "./google-services.json";
  if (!fs.existsSync(path.resolve(__dirname, file))) return config;
  return { ...config, android: { ...config.android, googleServicesFile: file } };
};
