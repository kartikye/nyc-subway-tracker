# NYC Subway Tracker

A "Catch 'Em All" style tracker for NYC subway stations. Track your progress visiting all subway stations across the MTA system.

## Features

- Interactive subway map with visual station markers
- Click stations on the map or use checkboxes to mark as visited
- X markers appear on visited stations
- Search functionality to quickly find stations
- Progress counter showing visited/total stations
- Server-based persistence using SQLite database
- Responsive design with Tailwind CSS
- Pure vanilla JavaScript frontend

## Tech Stack

- **Frontend**: HTML5, Tailwind CSS (via CDN), Vanilla JavaScript, SVG for map rendering
- **Backend**: Express.js server
- **Database**: SQLite (via better-sqlite3) for persistent storage

## Project Structure

```
subway-tracker/
├── index.html          # Main HTML file
├── stations.js         # Station data and line colors
├── app.js             # Frontend application logic
├── server.js          # Express server with SQLite backend
├── package.json       # Node.js dependencies
├── subway-tracker.db  # SQLite database (created on first run)
└── README.md          # This file
```

## Setup & Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser to:
   ```
   http://localhost:3001
   ```

## How to Use

1. Navigate to http://localhost:3001 in your browser
2. Click on station circles on the map OR check boxes in the station list
3. Red X markers will appear on visited stations
4. Use the search box to filter stations by name
5. Track your progress with the counter at the top
6. Click "Clear All" to reset all visited stations
7. Your progress is automatically saved to the server

## API Endpoints

- `GET /api/visited` - Returns array of visited station IDs
- `POST /api/visited/:stationId` - Mark station as visited
- `DELETE /api/visited/:stationId` - Unmark station
- `DELETE /api/visited` - Clear all visited stations

## Station Data

Includes all 496 official MTA subway stations across all lines:
- 1, 2, 3 (Red Line)
- 4, 5, 6 (Green Line)
- 7 (Purple Line)
- A, C, E (Blue Line)
- B, D, F, M (Orange Line)
- G (Light Green Line)
- J, Z (Brown Line)
- L (Gray Line)
- N, Q, R, W (Yellow Line)

## Future Enhancements

- Multi-user support with authentication
- Import/export progress data
- Achievement system
- Statistics and visualizations
- Mobile app version
- Share progress with friends
- Line-specific challenges

## Development

The application uses a simple Express server with SQLite for data persistence.

To modify the frontend, edit `index.html`, `app.js`, or `stations.js` and refresh your browser.

To modify the API, edit `server.js` and restart the server.

## License

MIT
