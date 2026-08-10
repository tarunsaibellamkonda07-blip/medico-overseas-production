require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { GoogleGenAI } = require("@google/genai");

const app = express();

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

if (!process.env.GEMINI_API_KEY) {
    console.error("ERROR: GEMINI_API_KEY is missing.");
    process.exit(1);
}

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

app.get("/", (req, res) => {
    res.json({
        status: "success",
        message: "Medico Overseas AI server is running"
    });
});

app.post("/api/chat", async (req, res) => {
    try {
        const message = req.body.message;

        if (!message || !message.trim()) {
            return res.status(400).json({
                error: "Message is required"
            });
        }

        console.log("User message:", message);

        const response = await ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: message
        });

        console.log("Gemini response received");

        res.json({
            reply: response.text
        });

    } catch (error) {
        console.error("Gemini Error:", error);

        res.status(500).json({
            error: "AI assistant could not process your request."
        });
    }
});

app.listen(PORT, () => {
    console.log(`Medico AI server running on port ${PORT}`);
});
