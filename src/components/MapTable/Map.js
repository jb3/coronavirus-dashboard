import React, { Component } from 'react';

import axios from "axios";
import 'mapbox-gl-leaflet';
import L from "leaflet";
import { max } from "d3-array";
import { scaleLinear, scaleSqrt } from "d3-scale";

import ErrorBoundary from "components/ErrorBoundary";

import 'leaflet/dist/leaflet.css';
import * as Styles from "./MapTable.styles";

import * as utils from "./utils";
import { OverrideCoordinates } from "./constants";

import type {
    MapState,
    MapProps
} from "MapTable.types"


export class Map extends Component<MapProps, {}> {

    #baseUrl = 'https://c19pub.azureedge.net/assets/geo/';
    #areaCodeSuffix = "cd";
    #areaNameSuffix = "nm";

    state: MapState = {

        layerGroup: null,
        map: null,
        canvas: null,
        loading: true,
        geoData: null,
        glStatus: utils.glAvailable(),

    }; // state

    initializeMap = () => {

        const
            mapbox = L.mapboxGL({
                attribution: '<a href="http://www.openstreetmap.org/about/" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a>',
                style: 'https://c19tile.azureedge.net/style.json'
            }),
            map = L.map('map', {
                center: [55.7, -3.7],
                zoom: 5.4,
                minZoom: 5.4,
                maxZoom: 12,
                layers: [mapbox]
            }),
            canvas = mapbox.getCanvas();

        if ( canvas )
            canvas.setAttribute(
                'aria-label',
                'Map showing number of COVID-19 cases by nation, region, or local authority in the UK'
            );

        map.zoomControl.setPosition('bottomright');

        return {
            map: map,
            layerGroup: L.layerGroup().addTo(map),
            canvas: canvas
        }

    }; // initializeMap

    getGeoData = async () => {

        const
            { geo, geoKey, geoDataSetter, geoData } = this.props,
            areaCodeKey = `${geoKey}${this.#areaCodeSuffix}`,
            getLatLong = ( key, { lat, long } ) =>
                OverrideCoordinates?.[key] ?? { lat: lat, long: long };

        let data = geoData;

        if ( !geoData ) {
            const response = await axios.get(geo, { baseURL: this.#baseUrl });

            data = response.data.features.map(f => ({
                ...f,
                properties: {
                    ...f.properties,
                    ...getLatLong(f.properties?.[areaCodeKey] ?? {}, f.properties),
                    id: f.properties?.[areaCodeKey] ?? "",
                },
            }));

        }

        this.setState({
            geoData: data,
            loading: false
        }, () => geoDataSetter(data) )

    }; // getGeoData

    componentDidUpdate(prevProps: Readonly<MapProps>, prevState: Readonly<MapState>, snapshot: any): void {

        if ( prevProps.geoKey !== this.props.geoKey && !this.props.geoData) {
            this.setState({
                    loading: true,
                    ...prevState.glStatus && !prevState.map
                        ? this.initializeMap()
                        : {}
                },
                this.getGeoData
            );

        } else if ( prevProps.geoKey !== this.props.geoKey && this.props.geoData) {
            this.setState({ geoData: this.props.geoData })
        }

    } // componentDidUpdate

    componentDidMount(): void {

        this.setState(prevState => ({
                loading: true,
                ...prevState.glStatus && !prevState.map
                    ? this.initializeMap()
                    : {}
            }),
            this.getGeoData
        );

    } // componentDidMount

    display() {

        const { loading, glStatus } = this.state;

        if ( loading ) return <Styles.P>Loading...</Styles.P>

        if ( !glStatus )
            return  <Styles.P>
                Your browser does not support WebGL or it has been disabled.
                You must install WebGL and ensure that it is enabled
                in the browser to see the map.
            </Styles.P>

        return null

    } // display

    render(): React.ReactNode {

        const
            { hash, maxCircleRadius, blobColour, geoKey, zoom, data, isRate } = this.props,
            { geoData, loading, map, layerGroup } = this.state,
            parsedHash = utils.getParams(hash),
            rgb = utils.hexToRgb(blobColour),
            colour = isRate
                ? `rgba(${rgb.r},${rgb.g},${rgb.b},.9)`
                : `rgba(${rgb.r},${rgb.g},${rgb.b},1)`;

        if (data && !loading && map && layerGroup ) {

            const
                areaCodeKey = `${geoKey}${this.#areaCodeSuffix}`,
                areaNameKey = `${geoKey}${this.#areaNameSuffix}`,
                maxValue = max(
                    data.values,
                    isRate ? (d => d.rateData.value) : (d => d.rawData.value)
                ),
                radiusScale = scaleSqrt().range([0, maxCircleRadius]).domain([0, maxValue]),
                shadeScale = scaleLinear().range([0, 1]).domain([0, maxValue]);

            layerGroup.clearLayers();

            const boundryLayer = L.geoJSON(geoData, {
                style: ({ properties: p }) => ({
                    color: '#0b0c0c',
                    weight: isRate ? .2 : .6,
                    opacity: .7,
                    fillColor: colour,
                    fillOpacity: isRate
                        ? shadeScale(data.getByKey(p.id)?.rateData?.value ?? 0)
                        : parsedHash?.area ?? -1 === p.id ? .2 : 0,
                }),
                onEachFeature: (feature, layer) => {
                    layer.on({
                        click: () => {
                            const
                                parent = document.getElementById(parsedHash.category),
                                id =  utils.createHash({
                                    category: parsedHash.category,
                                    map: parsedHash.map, area:
                                    data.getByKey(feature.properties.id).name
                                }),
                                element = document.getElementById(id.substring(1));

                            if (element && element.offsetParent)
                                parent.scrollTop = element.offsetParent.offsetTop - 80;

                            if (element) element.click();

                        },
                    });
                },
            });

            if (!isRate) {
                const blobs = L.geoJSON(
                    geoData.map(({ properties: p, properties: { [areaCodeKey]: key } }) => ({
                        type: 'Feature',
                        properties: {
                            name: data?.[key]?.name?.value ?? 0,
                            count: data.getByKey(key)?.[isRate ? "rateData" : "rawData"]?.value ?? 0
                        },
                        geometry: {
                            type: 'Point',
                            coordinates: [p.long, p.lat],
                        },
                    })),
                    {
                        pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
                            radius: feature.properties.count === 0 ? 0 : radiusScale(feature.properties.count),
                            fillColor: blobColour,
                            fillOpacity: 0.4,
                            weight: 0,
                        }),
                    },
                );
                layerGroup.addLayer(blobs)
            }

            layerGroup.addLayer(boundryLayer)

            if ( parsedHash.hasOwnProperty("area") ) {
                const flyCoords = geoData.filter(item =>
                    utils.prepAsKey(item.properties[areaNameKey]) === parsedHash.area
                ).pop();

                map.flyTo(
                    [flyCoords.properties.lat, flyCoords.properties.long],
                    zoom.max,
                    { animate: false }
                );
            }

        }

        return <ErrorBoundary>
            { this.display() }
            <Styles.Map id={ "map" }/>
        </ErrorBoundary>

    } // render

} // Map