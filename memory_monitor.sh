#!/bin/bash
# Memory monitoring script for debugging

echo "=== Memory Monitoring Started ==="
echo "Press Ctrl+C to stop"
echo ""

LOG_FILE="/home/z/my-project/memory_monitor.log"
echo "Time,PID,RSS_KB,VSZ_KB,PMEM" > "$LOG_FILE"

while true; do
    # Find next-server process
    PID=$(pgrep -f "next-server" | head -1)
    
    if [ -n "$PID" ]; then
        # Get memory stats
        STATS=$(ps -p "$PID" -o rss,vsz,pmem --no-headers 2>/dev/null)
        
        if [ -n "$STATS" ]; then
            RSS=$(echo "$STATS" | awk '{print $1}')
            VSZ=$(echo "$STATS" | awk '{print $2}')
            PMEM=$(echo "$STATS" | awk '{print $3}')
            
            TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
            echo "$TIMESTAMP,$PID,$RSS,$VSZ,$PMEM" >> "$LOG_FILE"
            
            # Print to console
            echo "[$TIMESTAMP] PID: $PID | RSS: ${RSS}KB ($(echo "scale=1; $RSS/1024" | bc)MB) | VSZ: ${VSZ}KB | Memory: ${PMEM}%"
        fi
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] No next-server process found"
    fi
    
    sleep 5
done
