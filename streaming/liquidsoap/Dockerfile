FROM savonet/liquidsoap:v2.3.3

# Copy the radio script into the container
COPY radio.liq /radio/radio.liq

# Run liquidsoap with the script
CMD ["liquidsoap", "/radio/radio.liq"]
