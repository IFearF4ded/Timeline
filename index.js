import express from "express";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// Serve your frontend
app.use(express.static(path.resolve("./public")));

app.get("/", (req, res) => {
  res.sendFile(path.resolve("./public/index.html"));
});

// Optional: ping endpoint to show server is alive
app.get("/ping", (req, res) => res.send("pong"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
