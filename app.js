const path = require("path");
const express = require("express");
const cors = require("cors");
const compression = require("compression");

const AppError = require("./utils/appError");
const globalErrorHandler = require("./controllers/errorController");
const openaiRoutes = require("./routes/openAIRoutes");
const translatorRoutes = require("./routes/translatorRoutes");
const docIntelRoutes = require("./routes/docIntelRoutes");
const historyRoutes = require("./routes/historyRoutes");
const promptsRoutes = require("./routes/promptRoutes");
const authRoutes = require("./routes/authRoutes");
const morgan = require("morgan");

const app = express();

// Security
app.set("trust proxy", true);

// TODO: Remove the localhost after deployment
app.use(
  cors({
    origin: ["https://almt.hella.com", "https://alm.hella.com", "http://localhost:5173", "http://10.13.8.242:5173"],
    credentials: true,
  })
);

app.options(
  "*",
  cors({
    origin: ["https://almt.hella.com", "https://alm.hella.com", "http://localhost:5173", "http://10.13.8.242:5173"],
  })
);

// Serving static files
app.use(express.static(path.join(__dirname, "public")));

// Development logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Transfer data to process
app.use(express.json({ limit: "50mb" }));
app.use(compression());

// Test route
app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Hello world!",
  });
});

// Routes
app.use("/api/v1/openai", openaiRoutes);
app.use("/api/v1/translator", translatorRoutes);
app.use("/api/v1/docIntel", docIntelRoutes);
app.use("/api/v1/history", historyRoutes);
app.use("/api/v1/prompts", promptsRoutes);
app.use("/api/v1/auth", authRoutes);

app.use("*", (req, res, next) => {
  next(new AppError(`No routes found at ${req.originalUrl}`, 404));
});

// Error hanlder
app.use(globalErrorHandler);
module.exports = app;
