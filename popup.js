document.getElementById("fetchButton").addEventListener("click", function () {
  console.log("Fetching conversations clicked!");
  // Displaying "Fetching..." message
  document.getElementById("feedback").innerText = "Fetching conversations...";

  // Sending message to background script to start fetching
  chrome.runtime.sendMessage({ action: "fetchConversations" });
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "conversationsFetched") {
    // Displaying "Conversations fetched!" message
    document.getElementById("feedback").innerText = "Conversations fetched!";
    updateConversationCount();
  }
});

chrome.storage.local.get(["bearerToken"], function (result) {
  let tokenElement = document.getElementById("token");
  let tokenNoticeElement = document.getElementById("tokenNotice");
  if (result.bearerToken) {
    document.getElementById("token").textContent = result.bearerToken;
    tokenElement.textContent = result.bearerToken;
    tokenNoticeElement.textContent = "Token successfully retrieved!";
    tokenNoticeElement.className = "alert alert-success";
  } else {
    tokenElement.textContent = "No token found.";
    tokenNoticeElement.textContent =
      "Failed to retrieve token (refresh your ChatGTP window).";
    tokenNoticeElement.className = "alert alert-danger";
  }
});

let db;

// Open the database
let openRequest = indexedDB.open("myDatabase", 1);

openRequest.onupgradeneeded = function (e) {
  db = e.target.result;
  if (!db.objectStoreNames.contains("textIndex")) {
    db.createObjectStore("textIndex", { autoIncrement: true });
  }
};

openRequest.onsuccess = function (e) {
  db = e.target.result;
};

openRequest.onerror = function (e) {
  console.error("Error opening database:", e);
};

function searchText(query, callback) {
  console.log("Searching for:", query);
  if (!db) {
    console.error("Database not opened");
    return;
  }

  const transaction = db.transaction(["textIndex"], "readonly");
  const store = transaction.objectStore("textIndex");
  const index = store.index("by_token");

  let results = new Set();
  let tokens = FullText.tokenize(query, "en"); // Assuming English locale for simplicity

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
          console.log("Search results:", results);
          callback(Array.from(results)); // Converting Set to Array for easier handling
        }
      }
    };
  });
}

document.getElementById("reloadButton").addEventListener("click", function () {
  console.log("Reload button clicked!");
  chrome.runtime.reload();
});

function searchEventHandler() {
  console.log("Search button clicked!");
  const query = document.getElementById("searchBox").value;
  chrome.runtime.sendMessage(
    { action: "search", query: query },
    function (results) {
      const resultsList = document.getElementById("results");
      resultsList.innerHTML = "Searching..";
      if (results.length === 0) {
        resultsList.textContent = "No results found.";
      } else {
        resultsList.innerHTML = ""; // Clear previous results
        results.forEach(function (conversationId) {
          // Retrieve and display each conversation
          chrome.runtime.sendMessage(
            { action: "getConversation", id: conversationId },
            function (conversation) {
              const li = document.createElement("li");
              const a = document.createElement("a");
              a.href = `https://chat.openai.com/c/${conversation.conversation_id}`;
              a.textContent = conversation.title;
              a.target = "_blank"; // Open link in a new tab
              li.appendChild(a);
              resultsList.appendChild(li);
            }
          );
        });
      }
    }
  );
}

document
  .getElementById("searchBox")
  .addEventListener("keypress", function (event) {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent the default action to avoid submitting a form if any
      console.log("Enter key pressed, initiating search...");
      searchEventHandler(); // Assuming searchText() is the function triggered by clicking the search button
    }
  });

document
  .getElementById("searchButton")
  .addEventListener("click", searchEventHandler);

function updateConversationCount() {
  let db;

  // Open the database
  let openRequest = indexedDB.open("myDatabase", 1);

  openRequest.onsuccess = function (event) {
    db = event.target.result;

    // Create a transaction and attempt to read all entries in the 'conversations' store
    let transaction = db.transaction(["conversations"], "readonly");
    let store = transaction.objectStore("conversations");
    let countRequest = store.count();

    countRequest.onsuccess = function () {
      // Display the count of conversations in the popup
      document.getElementById("conversationCount").textContent =
        countRequest.result;
    };

    countRequest.onerror = function () {
      console.error("Failed to count conversations:", countRequest.error);
      document.getElementById("conversationCount").textContent = "Error";
    };
  };

  openRequest.onerror = function (event) {
    console.error("Error opening database:", event.target.errorCode);
    document.getElementById("conversationCount").textContent = "Error";
  };
}

document.addEventListener("DOMContentLoaded", function () {
  updateConversationCount();
});
