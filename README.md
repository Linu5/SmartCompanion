# Smart Commuter Companion 🚇🚌

**Smart Commuter Companion (RailPulse Sentinel)** is a proactive decision-support web application built for the NEBULA X PS2 challenge. It acts as an intelligent travel companion for commuters in Singapore, automatically alerting them to MRT service disruptions and providing alternate bus routing before they are stranded on the platform.

## 🚀 Key Features

*   **Intelligent Alert Banner:** Integrates with LTA DataMall APIs to pull live Train Service Alerts. Displays service advisories seamlessly, and turns into a severe warning if an active disruption occurs.
*   **Proactive Decision Support:** During a disruption, or when the user's selected route intercepts an affected sector, a decision support panel auto-triggers. It provides realistic ETA comparisons (e.g., *🚇 Stay on MRT: ~45 min* vs *🚌 Proactive Reroute: ~18 min*) and crowding indicators to help commuters make informed decisions.
*   **Live Bus Timings:** Commuters can input any Bus Stop Code (e.g., `01012`) to get real-time arrivals of the next 3 buses, including the bus type (Single, Double, Bendy) and minutes to arrival.
*   **"My Route" Personalization:** Allows users to pick an Origin and Destination MRT station. The app actively monitors this route for disruptions.
*   **Dynamic Map & Route Trails:** Visualizes the entire Singapore MRT/LRT network using accurate line colors on an interactive dark-themed OpenStreetMap (Leaflet). Calculates the shortest path between Origin and Destination stations across the graph and draws a glowing trail over the actual physical tracks.

## 🛠️ Tech Stack

*   **Frontend:** Vanilla HTML, CSS, JavaScript
*   **Map Rendering:** Leaflet.js (OpenStreetMap with custom CSS dark mode filters)
*   **Backend / Proxy:** Node.js, Express (Proxies API requests and caches responses to prevent rate limits)
*   **Data Sources:** LTA DataMall (Train Service Alerts, Bus Arrival v3), Overpass API (Station GeoJSON mapping)

## ⚙️ Setup & Installation

To run this project locally, you will need Node.js installed and an LTA DataMall API Key.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Linu5/SmartCompanion.git
    cd SmartCompanion
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure environment variables:**
    *   Rename `.env.example` to `.env`.
    *   Insert your LTA DataMall Account Key:
        ```
        LTA_DATAMALL_API_KEY=your_api_key_here
        ```

4.  **Start the server:**
    ```bash
    npm start
    ```

5.  **View the app:**
    Open your browser and navigate to `http://localhost:3000`.

## 📂 Project Structure

*   `/public` - Contains the frontend logic (`app.js`, `style.css`, `index.html`) and the compiled `stations.geojson` containing exact coordinates and track line colors.
*   `server.js` - The Node.js Express server that serves static files and securely proxies Datamall APIs.
*   `/mock-data` - Fallback seed data designed to keep the app running flawlessly during hackathon demos, even if the LTA DataMall API rate limits or times out.
*   `merge_excel.js` - A utility script to cross-reference MRT Station Line codes and colors from an Excel dataset into the GeoJSON map data.
