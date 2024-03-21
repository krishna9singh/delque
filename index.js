const { Queue, Worker } = require("bullmq");
const User = require("./models/userAuth");
const Deluser = require("./models/deluser");
const Delivery = require("./models/Deliveries");
const Product = require("./models/product");
const Order = require("./models/orders");
const geolib = require("geolib");
const admin = require("./fireb");

const mongoose = require("mongoose");
require("dotenv").config();

const myQueue = new Queue("myqueue", {
  connection: {
    host: "192.168.29.221",
    port: 6379,
  },
});

const connectDB = async () => {
  try {
    mongoose.set("strictQuery", false);
    mongoose.connect(process.env.DATABASE).then(() => {
      console.log("DB is connected");
    });
  } catch (err) {
    console.log(err);
  }
};
connectDB();

const myWorker = new Worker(
  "delivery-pending",
  async (job) => {
    console.log(job?.data);
    credeli({ order: job?.data?.order });
  },
  {
    connection: {
      host: "192.168.29.221",
      port: 6379,
    },
  }
);
const credeli = async () => {
  const order = await Order.findOne({ orderId: "2013132" });
  try {
    const customer = await User.findById(order?.buyerId);

    //data of each product, seller
    let data = [];
    for (let i = 0; i < order.data.length; i++) {
      const product = await Product.findById(order.data[i].product);
      if (product) {
        data.push(order.data[i]);
      }
    }

    for (let i = 0; i < data.length; i++) {
      const store = await User.findById(data[i]?.seller);

      //   const check = geolib.isPointWithinRadius(
      //     {
      //       latitude: customer?.address?.coordinates?.latitude,
      //       longitude: customer?.address?.coordinates?.longitude,
      //     },
      //     {
      //       latitude: store?.address?.coordinates?.latitude,
      //       longitude: store?.address?.coordinates?.longitude,
      //     },
      //     20000
      //   );

      //assign the delivery to the partner
      let eligibledriver = [];
      const deliverypartner = await Deluser.find({
        accounttype: "partner",
      });

      for (let i = 0; i < deliverypartner.length; i++) {
        if (
          deliverypartner[i].accstatus !== "banned" &&
          deliverypartner[i].accstatus !== "review" &&
          deliverypartner[i].deliveries?.length < 21 &&
          deliverypartner[i].totalbalance < 3000
        ) {
          let driverloc = {
            latitude: deliverypartner[i].currentlocation?.latitude,
            longitude: deliverypartner[i].currentlocation?.longitude,
            id: deliverypartner[i]?._id,
          };
          eligibledriver.push(driverloc);
        }
      }

      if (eligibledriver?.length > 0) {
        const nearestpartner = geolib.findNearest(
          {
            latitude: eligibledriver[i].currentlocation?.latitude,
            longitude: eligibledriver[i].currentlocation?.longitude,
          },
          eligibledriver
        );

        if (nearestpartner) {
          const driver = await Deluser?.findById(nearestpartner?.id);

          const newDeliveries = new Delivery({
            title: customer?.fullname,
            amount: order?.total,
            orderId: order?.orderId,
            pickupaddress: store?.storeAddress,
            partner: driver?._id,
            droppingaddress: customer?.address,
            phonenumber: customer.phone,
            mode: order.paymentMode ? order?.paymentMode : "Cash",
            data: data,
          });
          await newDeliveries.save();

          //pushing delivery for driver
          await Deluser.updateOne(
            { _id: driver._id },
            { $push: { deliveries: newDeliveries._id } }
          );
          //   if (driver?.notificationtoken) {
          //     const msg = {
          //       notification: {
          //         title: "A new order has arrived.",
          //         body: `From ${customer?.fullname} OrderId #${order?.orderId}`,
          //       },
          //       data: {},
          //       token: driver?.notificationtoken,
          //     };

          //     await admin
          //       .messaging()
          //       .send(msg)
          //       .then((response) => {
          //         console.log("Successfully sent message");
          //       })
          //       .catch((error) => {
          //         console.log("Error sending message:", error);
          //       });
          //   }
        }
        console.log("Delivery assigned");
      } else {
        const r = await myQueue.add(
          "delivery-pending",
          { order },
          { removeOnComplete: true, removeOnFail: true }
        );
        console.log(r.id, "Added to delivery queue again");

        console.log("No delivery partner is available at the moment!");
      }
    }
  } catch (e) {
    console.log(e, "Error in Worker");
  }
};

credeli();
