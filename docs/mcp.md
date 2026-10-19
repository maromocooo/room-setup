# Building a room with an AI assistant (MCP)

**English** | [日本語](mcp.ja.md) | [README](../README.md)

Room Setup ships a [Model Context Protocol](https://modelcontextprotocol.io) server. Connect it to an assistant that can see images, such as Claude Code or Claude Desktop, and ask it to recreate your room:

> Here are four photos of my living room, taken from the middle towards each corner, the floor plan, and links to the sofa, TV stand and shelf. Please build it in Room Setup.

The assistant reads the photos and the plan itself. It then uses the tools to draw the walls, choose finishes, fetch product images and sizes from the links, generate and place each item, and take screenshots so it can compare the result with your photos and adjust. Everything appears live in the open app, and you can keep editing by hand at any point. The assistant sees your edits too.

## Setup

1. Install the gateway's Python packages (they include the MCP SDK) and start the API and the app:

   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
   npm run api     # terminal 1
   npm run dev     # terminal 2, then open the app in a browser
   ```

   Keep the app open: it shows the changes and renders the screenshots the assistant asks for. Generating furniture needs at least one engine (see [engines.md](engines.md)). `ROOM_SETUP_MOCK_ENGINE=1` makes the whole flow work without a GPU, with boxes as furniture.

2. Register the server with your assistant. Use absolute paths.

   **Claude Code**

   ```bash
   claude mcp add room-setup -- /path/to/room-setup/.venv/bin/python /path/to/room-setup/server/mcp_server.py
   ```

   **Claude Desktop** (`claude_desktop_config.json`)

   ```json
   {
     "mcpServers": {
       "room-setup": {
         "command": "/path/to/room-setup/.venv/bin/python",
         "args": ["/path/to/room-setup/server/mcp_server.py"]
       }
     }
   }
   ```

   The server reads `API_PORT` from the project's `.env`. To point it at another address, set `ROOM_SETUP_API` (for example `http://127.0.0.1:8001`) in the server's environment.

3. Give the assistant your photos and plan (attach them, or with Claude Code give their file paths) and your product links. The `furnish_room` prompt contains a ready-made request.

## Tips for good results

- **Photos**: stand in the middle of the room and photograph each corner with both walls and the floor visible. Natural light and a wide lens help.
- **Floor plan**: a clear image with dimensions (or a tatami/帖 count) lets the assistant get the size right. Without one, it estimates from the photos and tells you its assumptions.
- **Products**: product pages with a clean, plain-background photo and listed dimensions give the best models. Some shops (Amazon in particular) sometimes block automated access. In that case the assistant asks you for the image and size, or cuts the item out of your photo with `crop_photo`.
- Generation runs one item at a time, roughly 1–3 minutes each depending on the engine. Translucent boxes mark items that are still generating.
- Check the assistant's work in the app and simply fix anything by hand. Say "I moved the sofa; please continue" and it picks up your changes.

## Tools

| Tool | What it does |
|---|---|
| `get_room` | Walls, finishes, furniture (ids, sizes, positions, status), preset names |
| `set_room_outline` | Replace the walls with a closed outline (corner list in cm) and optionally the ceiling height |
| `add_wall`, `remove_wall` | Partitions and corrections |
| `add_opening`, `update_opening`, `remove_opening` | Doors and windows: preset, size, sill height, position on a wall, hinge/opening side |
| `set_ceiling_height` | Ceiling height in cm |
| `set_finishes` | Flooring/wallpaper preset or image, pattern scale, optionally for one wall |
| `clear_room` | Start over |
| `add_light`, `update_light`, `remove_light`, `set_time_of_day` | Light sources in generated lamps (`attach_to_furniture_id`) or fixtures; brightness, colour temperature, on/off; morning/day/evening/night |
| `lookup_product` | Title, size text, image URLs and the main image from a product page |
| `crop_photo` | Cut an item out of a room photo to use as a generation image |
| `list_engines` | Available generation engines |
| `add_furniture` | Generate a model from an image and place it (size, position, facing) |
| `update_furniture`, `remove_furniture` | Move, turn, resize, rename or delete; fix models generated upside down or on their side (`flip_upside_down`, `tip`) |
| `wait_for_furniture` | Wait for generation to finish (reports progress) |
| `render_view` | Screenshot: overview, top, plan, or a custom eye/target viewpoint |

**Coordinates.** Centimetres on the plan: x to the right, y downwards. Furniture positions are footprint centres. `facing_deg` is the direction the front points: 0 = down (+y), 90 = right, 180 = up, 270 = left.

## How it works

The gateway keeps one shared room document (`generated/scene.json`). The MCP server edits it over HTTP, using the document revision to avoid overwriting your concurrent edits. The browser subscribes to change events (`/api/scene/events`) and pushes its own edits back. `add_furniture` stores a placeholder entry and starts a generation job tied to it; when the job finishes, the gateway fills in the model and the open app swaps the box for the model. Screenshots are requested through the same event stream and rendered by the app, so `render_view` needs the app open in a browser.

The MCP server only talks to the local gateway, plus the product and image URLs the assistant asks it to fetch.
