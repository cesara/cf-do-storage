import indexHTML from "index.html";

export interface Env {
  storageTestDO: DurableObjectNamespace;
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    let workerID = globalThis.workerID;
    if (workerID === undefined) {
      workerID = crypto.randomUUID();
      globalThis.workerID = workerID;
    }
    const url = new URL(request.url);
    const forward = () => {
      const roomID = url.searchParams.get("roomID")
      if(!roomID) return new Response("roomID is required", { status: 400 });
      return env.storageTestDO
        .get(env.storageTestDO.idFromName(roomID))
        .fetch(request);
    };
    switch (url.pathname) {
      case "/":
        return new Response(indexHTML, {
          headers: {
            "content-type": "text/html;charset=UTF-8",
          },
        });
      case "/do-websocket":
        return forward();
    }
    return new Response("Not Found", { status: 404 });
  },
};

class StorageTestDO implements DurableObject {
  private readonly _doID: string;
  #storage: DurableObjectStorage;
  #ws: WebSocket | null = null;
  #keySize = 100;
  #nextAlarm = 66;
  #roomID = "";
  constructor(state: DurableObjectState) {
    this._doID = crypto.randomUUID();
    this.#storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/do-websocket":
        return this.handleWebSocketConnect(request, this._doID);
    }
    return new Response("Not Found", { status: 404 });
  }

  async alarm() {
    let i = 0;
    let dataSize = 0;
    console.log("Alarm triggered", this._doID, this.#roomID)
    if(!this.#roomID) return;

    const startTime = Date.now();
    const puts = [];
    while (i < this.#keySize) {
      //~20bytes of data x 100
      const data = JSON.stringify({
        x: Math.random() * 1000,
        y: Math.random() * 1000,
        data: "kifwpkieqojgsyqwodopjjtrhfndobkcbxzzgzdzxrqcqrcedrholhhdobkyasxupqqvjqrvszjktosodmxauaihmdzlsqbswavrkiwasytvkwhnmbkhcervqeikvcghehetllbzefglynjqtakadlggotqbfcymrmxfkexlwdibsmeabteyegvvwamudwfwpykzskla",
      });
      dataSize += new TextEncoder().encode(data).length; // Calculate and add the size of the current data.
      puts.push(
        this.#storage.put(i.toString(), data, {
          allowUnconfirmed: false,
          allowConcurrency: true,
        })
      );
      i++;
    }
    Promise.all(puts);
    await this.#storage.sync();
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log({ dataSize, count: i, startTime, endTime, duration })
    if (this.#ws) {
      this.#ws.send(
        JSON.stringify({ dataSize, count: i, startTime, endTime, duration })
      );
    }
    if(this.#ws?.readyState !== WebSocket.OPEN) {
      console.log("No WS connection, alarm shut off.");
      return;
    }
    this.#storage.setAlarm(Date.now() + this.#nextAlarm);
  }

  createResponseBody(
    serverID: string,
    i: number,
    pageTimestamp: number,
    serverTimestamp: number
  ) {
    return JSON.stringify({ serverID, i, pageTimestamp, serverTimestamp });
  }

  async handleWebSocketConnect(
    request: Request,
    doID: string
  ): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }

    const url = new URL(request.url);
    this.#keySize = parseInt(url.searchParams.get("keySize") ?? "100");
    this.#nextAlarm = parseInt(url.searchParams.get("nextAlarm") ?? "66");
    this.#roomID = url.searchParams.get("roomID") ?? "";
    const pair = new WebSocketPair();
    this.#ws = pair[1]; // Assign the WebSocket object to the class property.
    this.#ws.accept();

    this.#ws.addEventListener("message", async ({ data }) => {
      if (data === "cancelAlarm") {
        this.#ws?.send(JSON.stringify({message: "cancelAlarm, alarm shut off."}));
        console.log("before cancelled  storage list:");
        console.log(await this.#storage.list());
        await this.#storage.deleteAlarm();
        if (this.#ws)
          this.#ws.send(JSON.stringify({ message: "Alarm cancelled." }));
      }
    });

    this.#ws.addEventListener("close", async () => {
      this.#ws?.send(JSON.stringify({message: "WS closed, alarm shut off."}));
      await this.#storage.deleteAlarm(); // Call to shut off the alarm
      console.log("Connection closed, alarm shut off."); // Optional: Log or handle the closure
      return;
    });

    this.#ws.send("Starting alarm...");

    let currentAlarm = await this.#storage.getAlarm();

    this.#ws.send("Current Alarm: " + currentAlarm?.toString() ?? "null");
    if (currentAlarm == null) {
      this.#storage.setAlarm(Date.now() + 1);
      this.#ws.send(this.createResponseBody(doID, 0, Date.now(), Date.now()));
    }

    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}

export { worker as default, StorageTestDO };
