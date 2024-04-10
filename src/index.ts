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
      return env.storageTestDO
        .get(env.storageTestDO.idFromName("storage-tests-singleton"))
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
  constructor(state: DurableObjectState) {
    this._doID = crypto.randomUUID();
    this.#storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/do-websocket":
        return this.handleWebSocketConnect(request, this._doID, this.#storage);
    }
    return new Response("Not Found", { status: 404 });
  }

  async alarm() {
    let i = 0;
    let dataSize = 0; 
    const startTime = Date.now(); 
    while (i < 100) {
      //~20bytes of data x 100
      const data = JSON.stringify({
        x: i,
        y: i,
        data: "kifwpkieqojgsyqwodopjjtrhfndobkcbxzzgzdzxrqcqrcedrholhhdobkyasxupqqvjqrvszjktosodmxauaihmdzlsqbswavrkiwasytvkwhnmbkhcervqeikvcghehetllbzefglynjqtakadlggotqbfcymrmxfkexlwdibsmeabteyegvvwamudwfwpykzskla",
      });
      dataSize += new TextEncoder().encode(data).length; // Calculate and add the size of the current data.
      await this.#storage.put(i.toString(), data);
      i++;
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    if (this.#ws) {
      this.#ws.send(JSON.stringify({ dataSize, count: i, startTime, endTime, duration}));
    }

    this.#storage.setAlarm(Date.now() + 86);
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
    doID: string,
  ): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    const pair = new WebSocketPair();
    this.#ws = pair[1]; // Assign the WebSocket object to the class property.

    this.#ws.accept();

    this.#ws.addEventListener("message", async ({ data }) => {
      if (data === "cancelAlarm") {      
        await this.#storage.deleteAlarm(); 
        if(this.#ws) this.#ws.send(JSON.stringify({ message: "Alarm cancelled." })); 
      }
    });

    this.#ws.send("Starting alarm...");

    let currentAlarm = await this.#storage.getAlarm();
    if (currentAlarm == null) {
      this.#storage.setAlarm(Date.now() + 1);
      this.#ws.send(this.createResponseBody(doID, 0, Date.now(), Date.now()));
    }

    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}

export { worker as default, StorageTestDO };
