const https = require("https");
const fs = require("fs");
const dotenv = require("dotenv");

const options = {
  key: fs.readFileSync("server.key"),
  cert: fs.readFileSync("server.cert"),
};

process.on("uncaughtException", (err) => {
  console.log("UNCAUGHT EXCEPTION! Shutting down server...");
  console.log(err.message);
});

dotenv.config({ path: `./config.env` });
const app = require("./app");

const port = process.env.PORT || 8080;
const server = https.createServer(options, app).listen(port, () => {
  console.log(`App is running at port ${port}`);
});

process.on("unhandledRejection", (err) => {
  console.log("UNHANDLED REJECTION! Shutting down server...");
  console.log(err.message);
  server.close(() => {
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  console.log("👋 SIGTERM RECEIVED. Shutting down gracefully...");
  server.close(() => {
    console.log("Process terminated!");
  });
});
