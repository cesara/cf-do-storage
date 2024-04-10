# cf-do-storage

A test Cloudflare worker and durable object which demonstrates that durable object storage will reset after a certain about of time with sustained writes

## Running Locally
```bash
npm install

wrangler dev

# Then open http://localhost:8787 in your browser of choice.
```

## Running on Cloudflare
```
npm install

wrangler publish

# Then open the url for the worker output by the above wrangler publish command.
```
