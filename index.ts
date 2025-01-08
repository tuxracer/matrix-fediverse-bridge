import { MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";

interface APNote {
  "@context": string | string[];
  id: string;
  type: string;
  actor: string;
  to: string[];
  content: string;
}

const matrixHomeserverUrl = "https://your.matrix.server";
const matrixAccessToken = "MATRIX_ACCESS_TOKEN";
const matrixUserId = "@bridgebot:your.matrix.server";

const activityPubActor = "https://activitypub.instance/actors/username";
const activityPubInbox = "https://activitypub.instance/inbox";

async function main() {
  const storage = new SimpleFsStorageProvider("matrix.json");
  const client = new MatrixClient(matrixHomeserverUrl, matrixAccessToken, storage);

  await client.start();

  // Listen for incoming Matrix messages
  client.on("room.message", async (roomId: string, event: any) => {
    if (!event || !event.content || event.sender === matrixUserId) {
      return;
    }

    // Extract the plain text body
    const messageType = event.content["msgtype"];
    const messageBody = event.content["body"] || "";
    if (messageType === "m.text") {
      const note: APNote = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: `https://example.org/notes/${Date.now()}`,
        type: "Note",
        actor: activityPubActor, 
        to: [activityPubActor],
        content: messageBody,
      };

      try {
        const response = await fetch(activityPubInbox, {
          method: "POST",
          headers: {
            "Content-Type": "application/activity+json"
          },
          body: JSON.stringify(note)
        });
        if (!response.ok) {
          console.error("Failed to send to AP inbox:", await response.text());
        }
      } catch (err) {
        console.error("Error sending to AP inbox:", err);
      }
    }
  });

  console.log("Matrix-ActivityPub bridge is running.");
}

async function handleIncomingActivityPubRequest(body: any) {
  const note = body as APNote;
  const content = note.content || "";
  
  const targetUserId = "@targetuser:your.matrix.server";
  try {
    const dmRoom = await client.createRoom({
      preset: "private_chat",
      invite: [targetUserId],
      is_direct: true
    });

    await client.sendText(dmRoom.room_id, content);
  } catch (err) {
    console.error("Error sending Matrix DM:", err);
  }
}

main().catch((err) => console.error(err));