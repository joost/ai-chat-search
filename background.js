// Declare db at the top level of your background script to ensure it is globally accessible
let db;

importScripts("fulltext.js", "porterStemmer.js");

chrome.runtime.onInstalled.addListener(() => {
  console.log("onInstalled.");
});

self.addEventListener("install", (event) => {
  console.log("Service Worker installing.");
});

self.addEventListener("activate", (event) => {
  console.log("Service Worker activating.");
});

function fetchWithToken(url, options = {}) {
  console.log("Fetching with bearerToken:", url, options);
  return new Promise((resolve, reject) => {
    // Retrieve the bearerToken from local storage
    chrome.storage.local.get(["bearerToken"], function (result) {
      console.log("Got bearerToken from storage.");
      if (result.bearerToken) {
        // If the bearerToken exists, add it to the request headers
        options.headers = options.headers || {};
        options.headers["Authorization"] = `Bearer ${result.bearerToken}`;
        console.log("Making request with bearerToken...");
        // Make the fetch request

        // if (!response.ok) {
        //   throw new Error(
        //     `Failed to fetch conversation details for conversation ID ${conversationId}`
        //   );
        // }

        fetch(url, options)
          .then((response) => response.json())
          .then((data) => {
            // Resolve the Promise with the response data
            resolve(data);
          })
          .catch((error) => {
            // Reject the Promise with the error
            reject(error);
          });
      } else {
        console.log("No bearer token available");
        // If no bearerToken exists, reject the Promise with an error
        reject("No bearer token available");
      }
    });
  });
}

function getConversations(offset = 0, limit = 28) {
  console.log("getConversations");
  const url = `https://chat.openai.com/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`;
  console.log("fetchWithToken:", url);
  return fetchWithToken(url)
    .then((data) => {
      console.log("Fetched conversations:", data);
      return data;
      // chrome.runtime.sendMessage({ action: "conversationsFetched" });
    })
    .catch((error) => console.error("Error fetching conversations:", error));
}

async function getAllConversations() {
  console.log("getAllConversations");

  // "update_time": "2024-04-18T06:40:07.773645+00:00",

  let offset = 0;
  let limit = 100; // Max 100

  while (true) {
    const conversation = await getConversations(offset, limit);
    console.log("Conversations:", conversation);
    if (conversation && conversation.items && conversation.items.length !== 0) {
      for (let conv of conversation.items) {
        console.log("Conversation:", conv);
        details = await getConversationDetails(conv.id);
        console.log("Details:", details);
        processDataAndIndex(details);
      }
    } else {
      console.log("No new conversations found.");
      return;
    }
    offset += limit;
  }
  return;
}

async function getConversationDetails(conversationId) {
  console.log(
    "Fetching conversation details for conversation ID:",
    conversationId
  );
  const response = await fetchWithToken(
    `https://chat.openai.com/backend-api/conversation/${conversationId}`
  );
  return response;
}

chrome.runtime.onMessage.addListener(async function (
  message,
  sender,
  sendResponse
) {
  // Check if the message action is "fetchConversations"
  if (message.action === "fetchConversations") {
    console.log("background: Fetching conversations...");
    await getAllConversations();
    // sendResponse({ conversations: fetchedConversations });
    chrome.runtime.sendMessage({
      action: "conversationsFetched",
    });
  }
});

// Listener to intercept the session token
chrome.webRequest.onBeforeRequest.addListener(
  function (details) {
    if (
      details.method === "POST" &&
      details.url.includes("/api/auth/session")
    ) {
      const requestBody = JSON.parse(
        decodeURIComponent(
          String.fromCharCode.apply(
            null,
            new Uint8Array(details.requestBody.raw[0].bytes)
          )
        )
      );
      const accessToken = requestBody.accessToken;
      if (accessToken) {
        chrome.storage.local.set({ bearerToken: accessToken }, function () {
          console.log("Access token stored:", accessToken);
        });
      }
    }
  },
  // Filters
  {
    urls: ["<all_urls>"], // Intercept all URLs
    types: ["xmlhttprequest"], // Intercept XHR requests
  },
  // ExtraInfoSpec
  ["requestBody"] // Access to request body
);

// Storage
// Open (or create) the database
let openRequest = indexedDB.open("myDatabase", 1);

openRequest.onupgradeneeded = function (e) {
  // Save the database reference from the event target result
  db = e.target.result;
  if (!db.objectStoreNames.contains("conversations")) {
    db.createObjectStore("conversations", { keyPath: "conversation_id" });
  }
  if (!db.objectStoreNames.contains("textIndex")) {
    let store = db.createObjectStore("textIndex", {
      keyPath: "id",
      autoIncrement: true,
    });
    store.createIndex("by_token", "token", { unique: false });
  }
};

openRequest.onerror = function (e) {
  console.error("Error opening database:", e.target.errorCode);
};

openRequest.onsuccess = function (e) {
  // Once the database is successfully opened, assign it to the db variable
  db = e.target.result;
  db.onerror = function (event) {
    console.error("Database error: " + event.target.errorCode);
  };
};

function stripMarkdown(markdownText) {
  return markdownText
    .replace(/!\[.*?\]\(.*?\)/g, "") // Remove images
    .replace(/\[(.*?)\]\(.*?\)/g, "$1") // Remove link and keep text
    .replace(/`{3}.*?`{3}/gs, "") // Remove fenced code blocks
    .replace(/`{1,2}(.*?)`{1,2}/g, "$1") // Remove inline code
    .replace(/(#{1,6}\s?)/g, "") // Remove headers
    .replace(/(>+?\s?)/g, "") // Remove blockquotes
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // Remove bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // Remove italic
    .replace(/~~(.*?)~~/g, "$1") // Remove strikethrough
    .replace(/(\n\s*\n)/g, "\n"); // Replace multiple newlines with single
}

function indexTextContent(db, data, locale = "en") {
  const transaction = db.transaction("textIndex", "readwrite");
  const store = transaction.objectStore("textIndex");

  // Index the title
  console.log("Indexing title:", data.title);
  const titleTokens = FullText.tokenize(data.title, locale);
  titleTokens.forEach((token) => {
    console.log("Indexing token:", token);
    store.put({ token: token, ref: data.conversation_id });
  });

  // Index each 'part' in every message
  Object.values(data.mapping).forEach((item) => {
    if (item.message && item.message.content.parts) {
      item.message.content.parts.forEach((part) => {
        if (typeof part === "string") {
          console.log("Indexing part:", part);
          const text = stripMarkdown(part);
          console.log("Text:", text);
          const tokens = FullText.tokenize(text, locale);
          console.log("Tokens:", tokens);
          tokens.forEach((token) => {
            store.put({ token: token, ref: data.conversation_id });
          });
        } else {
          console.log("Part is not a string:", part);
        }
      });
    }
  });
}

// Function to add data
function addData(db, data, callback) {
  console.log("Adding data to the database...");
  const transaction = db.transaction("conversations", "readwrite");
  const store = transaction.objectStore("conversations");
  const request = store.put(data);
  request.onsuccess = function () {
    console.log("Data added to the database", request.result);
    callback(request.result);
  };
  request.onerror = function () {
    console.error("Error adding data: ", request.error);
  };
}

function processDataAndIndex(jsonData) {
  console.log("Processing data and indexing...");
  let db = openRequest.result;
  addData(db, jsonData, function (id) {
    console.log(`Data added to the database (${id})..starting indexing...`);
    indexTextContent(db, jsonData); // Call indexing after confirming data is added
  });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === "search") {
    performSearch(message.query).then(sendResponse);
    return true; // Indicate that you wish to use async sendResponse
  }
});

function performSearch(query) {
  return new Promise((resolve, reject) => {
    if (!db) {
      console.error("Database not opened");
      reject("Database not initialized.");
      return;
    }

    const transaction = db.transaction(["textIndex"], "readonly");
    const store = transaction.objectStore("textIndex");
    const index = store.index("by_token");
    let results = new Set();
    let tokens = FullText.tokenize(query, "en"); // Assuming English locale

    let pendingSearches = tokens.length;
    tokens.forEach((token) => {
      const range = IDBKeyRange.only(token);
      index.openCursor(range).onsuccess = function (event) {
        const cursor = event.target.result;
        if (cursor) {
          results.add(cursor.value.ref);
          cursor.continue();
        } else {
          pendingSearches--;
          if (pendingSearches <= 0) {
            resolve(Array.from(results));
          }
        }
      };
    });
  });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === "getConversation") {
    const transaction = db.transaction(["conversations"], "readonly");
    const store = transaction.objectStore("conversations");
    const request = store.get(message.id);
    request.onsuccess = function () {
      sendResponse(request.result);
    };
    request.onerror = function () {
      sendResponse(null);
    };
    return true; // Indicate that you wish to use async sendResponse
  }
});
