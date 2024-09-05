
import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import { promises as fss } from "fs";
import { PollyClient, StartSpeechSynthesisTaskCommand } from "@aws-sdk/client-polly";
import wav from 'wav';
import fs from 'fs';
import path from 'path';
import https from 'https';

// Import the AWS SDK
import AWS from 'aws-sdk';

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { fileURLToPath } from "url";

dotenv.config();

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY || "-", // Your OpenAI API key here, I used "-" to avoid errors when the key is not set but you should not do that
// });

// Configure AWS SDK
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Create a Polly client
const pollyClient = new PollyClient({
  region: "us-east-1" // specify your region
});

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "Xb7hH8MSUJpSbSDYk0k2";

// Create a Bedrock Runtime client in the AWS Region you want to use.
const client = new BedrockRuntimeClient({ region: "us-east-1" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadFile = (url, dest) => {
  const file = fs.createWriteStream(dest);
  https.get(url, (response) => {
    response.pipe(file);
    file.on('finish',  () => {
      file.close();
      console.log("Download Completed!!");
    });
  }).on('error', (err) => {
    fs.unlink(dest);
    console.log("Error in downloading: ", err.message);
  });
};

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  await execCommand(
    `.\\ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
    // -y to overwrite the file
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);
  await execCommand(
    `.\\rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  );
  // -r phonetic is faster but less accurate
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};



app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Hey dear... How was your day?",
          audio: await audioFileToBase64("audios/intro_0.wav"),
          lipsync: await readJsonTranscript("audios/intro_0.json"),
          facialExpression: "smile",
          animation: "Talking_1",
        },
        {
          text: "I missed you so much... Please don't go for so long!",
          audio: await audioFileToBase64("audios/intro_1.wav"),
          lipsync: await readJsonTranscript("audios/intro_1.json"),
          facialExpression: "sad",
          animation: "Crying",
        },
      ],
    });
    return;
  }
  if (!elevenLabsApiKey) {
    res.send({
      messages: [
        {
          text: "Please my dear, don't forget to add your API keys!",
          audio: await audioFileToBase64("audios/api_0.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"),
          facialExpression: "angry",
          animation: "Angry",
        },
        {
          text: "You don't want to ruin Wawa Sensei with a crazy ChatGPT and ElevenLabs bill, right?",
          audio: await audioFileToBase64("audios/api_1.wav"),
          lipsync: await readJsonTranscript("audios/api_1.json"),
          facialExpression: "smile",
          animation: "Laughing",
        },
      ],
    });
    return;
  }

  // const apiUrl = 'https://your-api-id.execute-api.region.amazonaws.com/stage/resource'; // Replace with your API Gateway endpoint

    // const fetchData = async () => {
    //   try {
    //     const response = await fetch(apiUrl, {
    //       method: 'POST', // or 'POST', 'PUT', etc. based on your API
    //       headers: {
    //         'Content-Type': 'application/json',
    //         // Add other headers if needed, such as Authorization
    //       },
    //       body: JSON.stringify({
    //         // Replace with your request payload
    //         query: 'example query',
    //         userId: 'example-user-id'
    //       }),
    //     });

    //     if (!response.ok) {
    //       throw new Error('Network response was not ok');
    //     }

    //     const data = await response.json();
    //     console.log(data);
    //   } catch (error) {
    //     console.error('Error fetching data:', error);
    //   }
    // };

    // fetchData();


  const promt = `
        You are a virtual bank teller.
        You will always reply with a JSON array of messages. With a maximum of 3 messages.
        Each message has a text, facialExpression, and animation property.
        The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
        The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry. 
        `

  const conversation = [
    {
      role: "user",
      content: [{ text: promt + userMessage }],
    },
  ]; 


  let responseText = "temp"

  const modelId = 'anthropic.claude-3-5-sonnet-20240620-v1:0'
  
  // Create a command with the model ID, the message, and a basic configuration.
  const command = new ConverseCommand({
    modelId ,
    messages: conversation,
    inferenceConfig: { maxTokens: 512, temperature: 0.5, topP: 0.9 },
  });
  
  try {
    // Send the command to the model and wait for the response
    const response = await client.send(command);
  
    // Extract and print the response text.
    responseText = response.output.message.content[0].text;
    // console.log(responseText);
  } catch (err) {
    console.log(`ERROR: Can't invoke '${modelId}'. Reason: ${err}`);
    process.exit(1);
  }

  // console.log(completion)

  let messages = JSON.parse(responseText);
  // console.log(messages)

  if (messages.messages) {
    messages = messages.messages; // ChatGPT is not 100% reliable, sometimes it directly returns an array and sometimes a JSON object with a messages property
  }
  // console.log(messages[0])
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    // generate audio file
    const fileName = `audios/message_${i}.mp3`; // The name of your audio file
    const textInput = message.text; // The text you wish to convert to speech

    // var params = {
    //   OutputFormat: "pcm",
    //   OutputS3BucketName: "topgun6-lambda-code",
    //   Text: textInput,
    //   TextType: "text",
    //   VoiceId: "Joanna",
    //   SampleRate: "22050",
    // };

    // const run = async () => {
    //   try {
    //     const response = await pollyClient.send(new StartSpeechSynthesisTaskCommand(params));
    //     console.log("Success, audio file added to " + params.OutputS3BucketName);
    //     // mp3_filePath = response.SynthesisTask.OutputUri
    //     // console.log(response.SynthesisTask.OutputUri)
    //     const mp3_urlPath = response.SynthesisTask.OutputUri
    //     // console.log(response)
    //     const filePath = path.join(__dirname, 'audios', response.SynthesisTask.TaskId)
    //     const file_name = response.SynthesisTask.TaskId;
    //     downloadFile(mp3_urlPath, filePath + '.mp3');
    //     // await lipSyncMessage(file_name);
    //     message.audio = await audioFileToBase64(filePath + '.mp3');
    //     message.lipsync = await readJsonTranscript(`audios/intro_1.json`);
    //   } catch (err) {
    //     console.log("Error synthesizinoog speech", err);
    //   }
    // };
    
    // run();

    // const mp3_filePath = response.SynthesisTask.OutputUri;
    // await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, "hello hero");
    // return 
    // generate lipsync
    const res = await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, textInput);
    console.log(res)
    // return
    // generate lipsync
    await lipSyncMessage(i);
    message.audio = await audioFileToBase64(fileName);
    message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
  }

  res.send({ messages });
});

const readJsonTranscript = async (file) => {
  const data = await fss.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fss.readFile(file);
  return data.toString("base64");
};

app.listen(port, () => {
  console.log(`bankteller listening on port ${port}`);
});


// import { exec } from "child_process";
// import cors from "cors";
// import dotenv from "dotenv";
// import voice from "elevenlabs-node";
// import express from "express";
// import { promises as fs } from "fs";
// import OpenAI from "openai";
// dotenv.config();

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY || "-", // Your OpenAI API key here, I used "-" to avoid errors when the key is not set but you should not do that
// });

// const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
// const voiceID = "Xb7hH8MSUJpSbSDYk0k2";

// const app = express();
// app.use(express.json());
// app.use(cors());
// const port = 3000;

// app.get("/", (req, res) => {
//   res.send("Hello World!");
// });

// app.get("/voices", async (req, res) => {
//   res.send(await voice.getVoices(elevenLabsApiKey));
// });

// const execCommand = (command) => {
//   return new Promise((resolve, reject) => {
//     exec(command, (error, stdout, stderr) => {
//       if (error) reject(error);
//       resolve(stdout);
//     });
//   });
// };

// const lipSyncMessage = async (message) => {
//   const time = new Date().getTime();
//   console.log(`Starting conversion for message ${message}`);
//   await execCommand(
//     `ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
//     // -y to overwrite the file
//   );
//   console.log(`Conversion done in ${new Date().getTime() - time}ms`);
//   await execCommand(
//     `./bin/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
//   );
//   // -r phonetic is faster but less accurate
//   console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
// };

// app.post("/chat", async (req, res) => {
//   const userMessage = req.body.message;
//   if (!userMessage) {
//     res.send({
//       messages: [
//         {
//           text: "Hey dear... How was your day?",
//           audio: await audioFileToBase64("audios/intro_0.wav"),
//           lipsync: await readJsonTranscript("audios/intro_0.json"),
//           facialExpression: "smile",
//           animation: "Talking_1",
//         },
//         {
//           text: "I missed you so much... Please don't go for so long!",
//           audio: await audioFileToBase64("audios/intro_1.wav"),
//           lipsync: await readJsonTranscript("audios/intro_1.json"),
//           facialExpression: "sad",
//           animation: "Crying",
//         },
//       ],
//     });
//     return;
//   }
//   if (!elevenLabsApiKey || openai.apiKey === "-") {
//     res.send({
//       messages: [
//         {
//           text: "Please my dear, don't forget to add your API keys!",
//           audio: await audioFileToBase64("audios/api_0.wav"),
//           lipsync: await readJsonTranscript("audios/api_0.json"),
//           facialExpression: "angry",
//           animation: "Angry",
//         },
//         {
//           text: "You don't want to ruin Wawa Sensei with a crazy ChatGPT and ElevenLabs bill, right?",
//           audio: await audioFileToBase64("audios/api_1.wav"),
//           lipsync: await readJsonTranscript("audios/api_1.json"),
//           facialExpression: "smile",
//           animation: "Laughing",
//         },
//       ],
//     });
//     return;
//   }

//   const completion = await openai.chat.completions.create({
//     model: "gpt-3.5-turbo-1106",
//     max_tokens: 1000,
//     temperature: 0.6,
//     response_format: {
//       type: "json_object",
//     },
//     messages: [
//       {
//         role: "system",
//         content: `
//         You are a virtual girlfriend.
//         You will always reply with a JSON array of messages. With a maximum of 3 messages.
//         Each message has a text, facialExpression, and animation property.
//         The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
//         The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry. 
//         `,
//       },
//       {
//         role: "user",
//         content: userMessage || "Hello",
//       },
//     ],
//   });
//   let messages = JSON.parse(completion.choices[0].message.content);
//   if (messages.messages) {
//     messages = messages.messages; // ChatGPT is not 100% reliable, sometimes it directly returns an array and sometimes a JSON object with a messages property
//   }
//   for (let i = 0; i < messages.length; i++) {
//     const message = messages[i];
//     // generate audio file
//     const fileName = `audios/message_${i}.mp3`; // The name of your audio file
//     const textInput = message.text; // The text you wish to convert to speech
//     await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, textInput);
//     // generate lipsync
//     await lipSyncMessage(i);
//     message.audio = await audioFileToBase64(fileName);
//     message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
//   }

//   res.send({ messages });
// });

// const readJsonTranscript = async (file) => {
//   const data = await fs.readFile(file, "utf8");
//   return JSON.parse(data);
// };

// const audioFileToBase64 = async (file) => {
//   const data = await fs.readFile(file);
//   return data.toString("base64");
// };

// app.listen(port, () => {
//   console.log(`Virtual Girlfriend listening on port ${port}`);
// });


